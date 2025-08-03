import json
import os
import random
import string
from datetime import datetime, timezone
import logging
from flask import Flask, render_template, request, redirect, url_for, jsonify, flash
from flask_login import LoginManager, login_user, logout_user, login_required, current_user
from flask_sock import Sock
from database import db, User, Contact, Message
from chat_logic import ChatManager

# logs
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('messenger.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

# init
base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
parent_dir = os.path.dirname(base_dir)


app = Flask(__name__,
            template_folder=os.path.join(base_dir, 'frontend', 'templates'),
            static_folder=os.path.join(base_dir, 'frontend', 'static'))

app.config['SECRET_KEY'] = 'your-secret-key-here'
app.config['SQLALCHEMY_DATABASE_URI'] = f"sqlite:///{os.path.join(parent_dir, 'messenger.db')}"
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
os.environ['PYTHONHASHSEED'] = '0'

# Инициализация расширений
db.init_app(app)
login_manager = LoginManager(app)
login_manager.login_view = 'login'
sock = Sock(app)

active_connections = {}


def generate_tag():
    return '#' + ''.join(random.choices(string.digits, k=4))


def broadcast_user_status(user_id, status):
    user = db.session.get(User, user_id)
    if not user:
        return

    user.last_seen = datetime.now(timezone.utc) if status == 'offline' else None
    db.session.commit()

    status_data = {
        'type': 'user_status',
        'user_id': user_id,
        'status': status,
        'last_seen': user.last_seen.isoformat() if status == 'offline' else None
    }

    connections = list(active_connections.items())
    for conn_user_id, ws in connections:
        if conn_user_id != user_id:
            try:
                ws.send(json.dumps(status_data))
            except Exception as e:
                logger.error(f"Error sending status to user {conn_user_id}: {str(e)}")
                if conn_user_id in active_connections:
                    del active_connections[conn_user_id]

def handle_websocket_close(ws, user_id):
    if user_id in active_connections:
        del active_connections[user_id]
    broadcast_user_status(user_id, 'offline')
    logger.info(f"User {user_id} disconnected")


def send_to_user(user_id, data):
    ws = active_connections.get(user_id)
    if ws:
        try:
            ws.send(json.dumps(data))
        except Exception as e:
            logger.error(f"Error sending to user {user_id}: {str(e)}")
            if user_id in active_connections:
                del active_connections[user_id]


def broadcast(data):
    connections = list(active_connections.items())
    for user_id, ws in connections:
        try:
            ws.send(json.dumps(data))
        except Exception as e:
            logger.error(f"Error broadcasting to user {user_id}: {str(e)}")
            if user_id in active_connections:
                del active_connections[user_id]


@sock.route('/ws')
@login_required
def handle_websocket(ws):
    if not current_user.is_authenticated:
        ws.close()
        return
    user_id = current_user.id
    active_connections[user_id] = ws
    logger.info(f"User {user_id} connected via WebSocket")

    try:
        send_to_user(user_id, {
            'type': 'connection_success',
            'message': 'WebSocket connection established'
        })

        broadcast_user_status(user_id, 'online')

        while True:
            message = ws.receive()
            if not message:
                continue

            try:
                data = json.loads(message)
                handle_websocket_message(data, ws)
            except json.JSONDecodeError:
                logger.error("Invalid JSON received")
                send_to_user(user_id, {
                    'type': 'error',
                    'message': 'Invalid message format'
                })
            except Exception as e:
                logger.error(f"Error handling message: {str(e)}")
                send_to_user(user_id, {
                    'type': 'error',
                    'message': str(e)
                })

    except Exception as e:
        logger.error(f"WebSocket error for user {user_id}: {str(e)}")
    finally:
        if user_id in active_connections:
            del active_connections[user_id]
        broadcast_user_status(user_id, 'offline')
        logger.info(f"User {user_id} disconnected")


def handle_websocket_message(data, ws):
    message_type = data.get('type')

    if message_type == 'send_message':
        handle_send_message(data)
    elif message_type == 'mark_as_read':
        handle_mark_as_read(data)
    elif message_type == 'get_history':
        handle_get_history(data, ws)
    elif message_type == 'join_chat':
        handle_join_chat(data, ws)


def handle_send_message(data):
    contact_id = int(data.get('contact_id'))
    content = data.get('content', '').strip()

    if not content:
        send_to_user(current_user.id, {'type': 'error', 'message': 'Message cannot be empty'})
        return

    contact = db.session.get(User, contact_id)
    if not contact:
        send_to_user(current_user.id, {'type': 'error', 'message': 'Contact not found'})
        return

    message = Message(
        sender_id=current_user.id,
        receiver_id=contact_id,
        content=content,
        timestamp=datetime.now(timezone.utc),
        is_read=False
    )
    db.session.add(message)
    db.session.commit()

    message_data = {
        'type': 'new_message',
        'id': message.id,
        'sender_id': current_user.id,
        'sender_name': current_user.username,
        'content': message.content,
        'timestamp': message.timestamp.isoformat(),
        'is_read': False,
        'contact_id': contact_id
    }

    send_to_user(contact_id, message_data)
    send_to_user(current_user.id, message_data)


def handle_mark_as_read(data):
    contact_id = int(data.get('contact_id'))
    ChatManager.mark_messages_as_read(current_user.id, contact_id)

    read_data = {
        'type': 'messages_read',
        'contact_id': contact_id,
        'user_id': current_user.id
    }
    broadcast(read_data)


def generate_random_tag(length=10):
    """random tag like @user-xxxxxx"""
    chars = string.ascii_lowercase + string.digits + '_-+'
    return '@user-' + ''.join(random.choice(chars) for _ in range(length))

def is_valid_tag(tag):
    """check tag"""
    if not tag.startswith('@'):
        return False
    allowed_chars = string.ascii_lowercase + string.digits + '_-+'
    return all(c in allowed_chars for c in tag[1:])


def handle_get_history(data, ws):
    contact_id = int(data.get('contact_id'))
    messages = Message.query.filter(
        ((Message.sender_id == current_user.id) & (Message.receiver_id == contact_id)) |
        ((Message.sender_id == contact_id) & (Message.receiver_id == current_user.id))
    ).order_by(Message.timestamp.asc()).all()

    history_data = {
        'type': 'message_history',
        'contact_id': contact_id,
        'messages': [{
            'id': msg.id,
            'sender_id': msg.sender_id,
            'sender_name': msg.sender.username,
            'content': msg.content,
            'timestamp': msg.timestamp.isoformat(),
            'is_read': msg.is_read
        } for msg in messages]
    }

    ws.send(json.dumps(history_data))


def handle_join_chat(data, ws):
    contact_id = int(data.get('contact_id'))
    handle_get_history(data, ws)


# /
@app.route('/')
@login_required
def home():
    contacts = Contact.query.filter_by(user_id=current_user.id).all()
    contacts_data = []

    for contact in contacts:
        unread_count = ChatManager.get_unread_count(current_user.id, contact.contact_id)
        last_message = ChatManager.get_last_message(current_user.id, contact.contact_id)

        contacts_data.append({
            'contact': contact,
            'unread_count': unread_count,
            'last_message': last_message
        })

    return render_template('chats.html',
                           contacts_data=contacts_data,
                           current_user=current_user,
                           now=datetime.now(timezone.utc))


@app.route('/search_users', methods=['GET'])
@login_required
def search_users():
    query = request.args.get('query', '').strip().lower()

    if not query:
        return jsonify([])

    # search usernames
    users = User.query.filter(
        (User.username.ilike(f'%{query}%')) |
        (User.tag.ilike(f'%{query}%'))
    ).filter(
        User.id != current_user.id
    ).limit(10).all()

    return jsonify([{
        'id': user.id,
        'username': user.username,
        'tag': user.tag
    } for user in users])


@app.route('/add_contact', methods=['POST'])
@login_required
def add_contact():
    username = request.form.get('username')
    tag = request.form.get('tag')

    if not username or not tag:
        flash('Please fill all fields', 'error')
        return redirect(url_for('home'))

    contact = User.query.filter_by(username=username, tag=tag).first()
    if not contact:
        flash('User not found', 'error')
        return redirect(url_for('home'))

    if contact.id == current_user.id:
        flash('Cannot add yourself', 'error')
        return redirect(url_for('home'))

    existing = Contact.query.filter_by(
        user_id=current_user.id,
        contact_id=contact.id
    ).first()

    if existing:
        flash('Contact already exists', 'error')
        return redirect(url_for('home'))

    try:
        new_contact = Contact(user_id=current_user.id, contact_id=contact.id)
        db.session.add(new_contact)
        db.session.commit()
        flash('Contact added successfully!', 'success')
    except Exception as e:
        db.session.rollback()
        flash('Error adding contact', 'error')

    return redirect(url_for('home'))


@app.route('/add_friend', methods=['POST'])
@login_required
def add_friend():
    friend_id = request.form.get('friend_id')
    if not friend_id:
        return jsonify({'status': 'error', 'message': 'Friend ID is required'}), 400

    friend = db.session.get(User, friend_id)
    if not friend:
        return jsonify({'status': 'error', 'message': 'User not found'}), 404

    if int(friend_id) == current_user.id:
        return jsonify({'status': 'error', 'message': 'Cannot add yourself'}), 400

    try:
        existing = db.session.execute(
            db.select(Contact)
            .where(Contact.user_id == current_user.id)
            .where(Contact.contact_id == friend_id)
            .with_for_update()
        ).scalar_one_or_none()

        if existing:
            return jsonify({'status': 'error', 'message': 'Contact already added'}), 400

        contact1 = Contact(user_id=current_user.id, contact_id=friend_id)
        contact2 = Contact(user_id=friend_id, contact_id=current_user.id)

        db.session.add(contact1)
        db.session.add(contact2)
        db.session.commit()

        return jsonify({
            'status': 'success',
            'message': 'Contact added successfully',
            'contact': {
                'id': friend.id,
                'username': friend.username,
                'tag': friend.tag
            }
        })
    except Exception as e:
        db.session.rollback()
        logger.error(f"Error adding friend: {str(e)}")
        return jsonify({'status': 'error', 'message': 'Internal server error'}), 500

@app.route('/change_tag', methods=['POST'])
@login_required
def change_tag():
    new_tag = request.form.get('tag', '').lower().strip()

    if not is_valid_tag(new_tag):
        return jsonify(
            {'status': 'error', 'message': 'Invalid tag format. Only a-z, 0-9, _, -, + allowed after @'}), 400

    if User.query.filter(User.tag == new_tag, User.id != current_user.id).first():
        return jsonify({'status': 'error', 'message': 'Tag already taken'}), 400

    current_user.tag = new_tag
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Tag updated successfully'})


# auth

@app.route('/login', methods=['GET', 'POST'])
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']
        user = User.query.filter_by(username=username).first()

        if user and user.check_password(password):
            login_user(user)
            return redirect(url_for('home'))

        return "Invalid username or password", 401

    return render_template('login.html')


@app.route('/register', methods=['GET', 'POST'])
def register():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        if User.query.filter_by(username=username).first():
            return "Username already taken", 400

        user = User(username=username, tag=generate_random_tag())
        user.set_password(password)
        db.session.add(user)
        db.session.commit()

        login_user(user)
        return redirect(url_for('home'))

    return render_template('register.html')

@app.route('/change_username', methods=['POST'])
@login_required
def change_username():
    new_username = request.form.get('username', '').strip()

    if len(new_username) < 3 or len(new_username) > 20:
        return jsonify({'status': 'error', 'message': 'Username must be between 3 and 20 characters'}), 400

    if User.query.filter(User.username == new_username, User.id != current_user.id).first():
        return jsonify({'status': 'error', 'message': 'Username already taken'}), 400

    current_user.username = new_username
    db.session.commit()

    return jsonify({'status': 'success', 'message': 'Username updated successfully'})

@app.route('/logout')
@login_required
def logout():
    logout_user()
    return redirect(url_for('login'))


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))


if __name__ == '__main__':
    with app.app_context():
        db.create_all()

    from gevent import monkey

    monkey.patch_all()

    from gevent.pywsgi import WSGIServer

    server = WSGIServer(('0.0.0.0', 25607), app) # use localhost:25607
    server.serve_forever()