from datetime import datetime
from database import db, Message, User

from datetime import datetime, timezone

now=datetime.now(timezone.utc)

class ChatManager:
    @staticmethod
    def get_chat_history(user_id, contact_id, limit=100):
        return Message.query.filter(
            ((Message.sender_id == user_id) & (Message.receiver_id == contact_id)) |
            ((Message.sender_id == contact_id) & (Message.receiver_id == user_id))
        ).order_by(Message.timestamp.desc()).limit(limit).all()

    @staticmethod
    def send_message(sender_id, receiver_id, content):
        if not content or not content.strip():
            raise ValueError("Message content cannot be empty")

        message = Message(
            sender_id=sender_id,
            receiver_id=receiver_id,
            content=content.strip(),
            timestamp=datetime.now(timezone.utc),
            is_read=False
        )
        db.session.add(message)
        db.session.commit()
        return message

    @staticmethod
    def mark_messages_as_read(user_id, contact_id):
        Message.query.filter_by(
            sender_id=contact_id,
            receiver_id=user_id,
            is_read=False
        ).update({'is_read': True})
        db.session.commit()

    @staticmethod
    def get_unread_count(user_id, contact_id=None):
        query = Message.query.filter_by(
            receiver_id=user_id,
            is_read=False
        )

        if contact_id:
            query = query.filter_by(sender_id=contact_id)

        return query.count()

    @staticmethod
    def get_last_message(user_id, contact_id):
        return Message.query.filter(
            ((Message.sender_id == user_id) & (Message.receiver_id == contact_id)) |
            ((Message.sender_id == contact_id) & (Message.receiver_id == user_id))
        ).order_by(Message.timestamp.desc()).first()