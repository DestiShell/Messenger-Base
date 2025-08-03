document.addEventListener('DOMContentLoaded', function() {
    const currentUserId = parseInt(document.querySelector('.user-info').dataset.userId);
    const settingsBtn = document.getElementById('settings-btn');
    const settingsPanel = document.querySelector('.settings-panel');
    const closeSettingsBtn = document.querySelector('.close-settings');
    const logoutBtn = document.getElementById('logout-btn');
    const overlay = document.createElement('div');

    overlay.className = 'overlay';
    document.body.appendChild(overlay);
    let currentContactId = null;
    let currentContactName = null;
    let currentContactTag = null;
    let socket = null;
    let reconnectAttempts = 0;
    const maxReconnectAttempts = 5;
    const reconnectDelay = 3000;
    let pingInterval;
    let lastActionTime = Date.now();
    let isSending = false;

    // DOM Elements
    const elements = {
        addContactBtn: document.getElementById('add-contact-btn'),
        modal: document.getElementById('add-contact-modal'),
        closeBtn: document.querySelector('.close'),
        contactsContainer: document.querySelector('.contact-list'),
        messagesContainer: document.getElementById('messages'),
        messageInput: document.getElementById('message-input'),
        messageText: document.getElementById('message-text'),
        sendBtn: document.getElementById('send-btn'),
        chatWith: document.getElementById('chat-with'),
        searchInput: document.getElementById('search-input'),
        searchResults: document.getElementById('search-results'),
            addContactModal: document.getElementById('add-contact-modal'),
    closeAddContactBtn: document.getElementById('close-add-contact'),
    changeTagModal: document.getElementById('change-tag-modal'),
    closeChangeTagBtn: document.getElementById('close-change-tag'),
            clearTagInput: document.getElementById('clear-tag-input'),
    newTagInput: document.getElementById('new-tag-input')
    };

    elements.clearTagInput.addEventListener('click', () => {
    elements.newTagInput.value = '';
    elements.newTagInput.focus();
});


// Обработчики для открытия/закрытия панели настроек
settingsBtn.addEventListener('click', () => {
    settingsPanel.classList.add('open');
    overlay.style.display = 'block';
    document.body.style.overflow = 'hidden';
});

closeSettingsBtn.addEventListener('click', closeSettings);
overlay.addEventListener('click', closeSettings);

function closeSettings() {
    settingsPanel.classList.remove('open');
    overlay.style.display = 'none';
    document.body.style.overflow = '';
}

// Обработчик для кнопки выхода
logoutBtn.addEventListener('click', () => {
    window.location.href = '/logout';
});

// Обработчик для кнопки изменения тега (уже должен быть в вашем коде)
document.getElementById('change-tag-btn').addEventListener('click', function() {
    closeSettings();
    document.getElementById('change-tag-modal').style.display = 'block';
    document.getElementById('new-tag-input').focus();
});

// обработчик сохранения тега
document.getElementById('save-tag-btn').addEventListener('click', function() {
    const newTag = elements.newTagInput.value.trim();
    const errorElement = document.getElementById('tag-error');

    // Очищаем предыдущие ошибки
    errorElement.textContent = '';

    if (!newTag.startsWith('@')) {
        errorElement.textContent = 'Tag must start with @';
        return;
    }

    if (newTag.length < 5 || newTag.length > 20) {
        errorElement.textContent = 'Tag must be between 5 and 20 characters';
        return;
    }

    // Показываем спиннер на кнопке
    this.innerHTML = '<div class="spinner"></div>';

    fetch('/change_tag', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `tag=${encodeURIComponent(newTag)}`
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            closeModal(elements.changeTagModal);
            // Обновляем отображение тега
            document.querySelector('.user-info span').textContent = newTag;
            showNotification('Tag updated successfully');
        } else {
            errorElement.textContent = data.message;
        }
    })
    .catch(error => {
        errorElement.textContent = 'Error updating tag';
    })
    .finally(() => {
        // Восстанавливаем кнопку
        this.innerHTML = 'Save Changes';
    });
});

    //обработчики событий:
elements.closeAddContactBtn.addEventListener('click', () => {
    elements.addContactModal.style.display = 'none';
    elements.searchResults.style.display = 'none';
});

elements.closeChangeTagBtn.addEventListener('click', () => {
    elements.changeTagModal.style.display = 'none';
});

// обработчик клика по overlay:
window.addEventListener('click', (e) => {
    if (e.target === elements.addContactModal) {
        elements.addContactModal.style.display = 'none';
        elements.searchResults.style.display = 'none';
    }
    if (e.target === elements.changeTagModal) {
        elements.changeTagModal.style.display = 'none';
    }
});

    // WebSocket Functions
    function connectWebSocket() {
        if (socket && socket.readyState !== WebSocket.CLOSED) {
            socket.close();
        }

        const protocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
        const wsUrl = protocol + window.location.host + '/ws';

        socket = new WebSocket(wsUrl);

        socket.onopen = () => {
            console.log('WebSocket connected');
            reconnectAttempts = 0;

            // Send authentication
            const authMessage = {
                type: 'authenticate',
                user_id: currentUserId
            };
            socket.send(JSON.stringify(authMessage));

            // Subscribe to current chat if exists
            if (currentContactId) {
                socket.send(JSON.stringify({
                    type: 'subscribe',
                    contact_id: currentContactId
                }));
            }

            // Start ping interval
            pingInterval = setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) {
                    socket.send(JSON.stringify({ type: 'ping' }));
                }
            }, 30000);
        };

        socket.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                handleWebSocketMessage(data);
            } catch (e) {
                console.error('Error parsing WebSocket message:', e);
            }
        };

        socket.onclose = (event) => {
            console.log('WebSocket disconnected:', event.code, event.reason);
            if (pingInterval) clearInterval(pingInterval);

            if (event.code !== 1000 && reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                console.log(`Attempting to reconnect (${reconnectAttempts}/${maxReconnectAttempts})...`);
                setTimeout(connectWebSocket, reconnectDelay);
            } else {
                showNotification('Disconnected from server', 'error');
            }
        };

        socket.onerror = (error) => {
            console.error('WebSocket error:', error);
            //showNotification('Connection error', 'error');
        };
    }

    // Функция для плавного закрытия модального окна
function closeModal(modalElement) {
    modalElement.classList.add('closing');
    setTimeout(() => {
        modalElement.style.display = 'none';
        modalElement.classList.remove('closing');
    }, 300); // Должно совпадать с длительностью анимации
}

// обработчики закрытия
elements.closeAddContactBtn.addEventListener('click', () => {
    closeModal(elements.addContactModal);
    elements.searchResults.style.display = 'none';
});

elements.closeChangeTagBtn.addEventListener('click', () => {
    closeModal(elements.changeTagModal);
});

// обработчик клика по overlay
window.addEventListener('click', (e) => {
    if (e.target === elements.addContactModal) {
        closeModal(elements.addContactModal);
        elements.searchResults.style.display = 'none';
    }
    if (e.target === elements.changeTagModal) {
        closeModal(elements.changeTagModal);
    }
});

// открытие модальных окон, чтобы сбрасывать состояние
elements.addContactBtn.addEventListener('click', () => {
    elements.addContactModal.style.display = 'block';
    elements.addContactModal.style.opacity = '1';
    elements.searchInput.focus();
});

document.getElementById('change-tag-btn').addEventListener('click', function() {
    elements.changeTagModal.style.display = 'block';
    elements.changeTagModal.style.opacity = '1';
    document.getElementById('new-tag-input').focus();
});

    function handleWebSocketMessage(data) {
        console.log('WebSocket message received:', data);

        switch(data.type) {
            case 'connection_success':
                console.log('Successfully connected to WebSocket server');
                break;

            case 'new_message':
                // Игнорируем свои же сообщения, они уже отображены оптимистично
                if (data.sender_id !== currentUserId) {
                    handleNewMessage(data);
                }
                break;

            case 'message_history':
                handleMessageHistory(data);
                break;

            case 'messages_read':
                handleMessagesRead(data);
                break;

            case 'user_status':
                handleUserStatus(data);
                break;

            case 'pong':
                // Keep alive response
                break;

            case 'error':
                showNotification(data.message, 'error');
                break;

            default:
                console.warn('Unknown message type:', data.type);
        }
    }

    // Message Handlers
    function handleNewMessage(data) {
        const isCurrentChat = data.sender_id === currentContactId ||
                            (data.sender_id === currentUserId && data.contact_id === currentContactId);

        if (isCurrentChat) {
            displayMessage(data);
            updateLastMessage(data);

            if (data.sender_id === currentContactId) {
                markAsRead(currentContactId);
            }
        } else if (data.sender_id !== currentUserId) {
            updateUnreadCount(data.sender_id, 1);
            showNotification(`New message from ${data.sender_name}`, 'info');
        }
    }

    function handleMessageHistory(data) {
        if (data.contact_id === currentContactId) {
            elements.messagesContainer.innerHTML = '';
            data.messages.forEach(msg => {
                displayMessage({
                    id: msg.id,
                    sender_id: msg.sender_id,
                    sender_name: msg.sender_name,
                    content: msg.content,
                    timestamp: msg.timestamp,
                    is_read: msg.is_read
                });
            });
            scrollToBottom();
        }
    }

    function handleMessagesRead(data) {
        if (data.contact_id === currentContactId && data.user_id !== currentUserId) {
            document.querySelectorAll('.message[data-message-id].unread').forEach(el => {
                el.classList.remove('unread');
                const status = el.querySelector('.read-status');
                if (status) status.textContent = '✓✓';
            });
        }
    }

    function handleUserStatus(data) {
        const contactElement = document.querySelector(`.contact[data-contact-id="${data.user_id}"]`);
        if (contactElement) {
            const statusElement = contactElement.querySelector('.online-status');
            if (statusElement) {
                statusElement.classList.toggle('online', data.status === 'online');
                statusElement.classList.toggle('offline', data.status !== 'online');
            }
        }
    }

    // UI Functions
    function displayMessage(msg) {
        const messageDiv = document.createElement('div');
        messageDiv.classList.add('message');
        messageDiv.dataset.messageId = msg.id;

        const isCurrentUser = msg.sender_id === currentUserId;
        const senderName = isCurrentUser ? 'You' : msg.sender_name || currentContactName;

        if (isCurrentUser) {
            messageDiv.classList.add('sent');
        } else {
            messageDiv.classList.add('received');
            if (!msg.is_read) {
                messageDiv.classList.add('unread');
            }
        }

        const date = new Date(msg.timestamp);
        const timeString = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

        messageDiv.innerHTML = `
            <strong>${senderName}</strong>
            <p>${msg.content}</p>
            <span class="timestamp">${timeString}</span>
            ${isCurrentUser ? `<span class="read-status">${msg.is_read ? '✓✓' : '✓'}</span>` : ''}
        `;

        elements.messagesContainer.appendChild(messageDiv);
        scrollToBottom();
    }

    function scrollToBottom() {
        elements.messagesContainer.scrollTop = elements.messagesContainer.scrollHeight;
    }

    function updateUnreadCount(contactId, change) {
        const contactElement = document.querySelector(`.contact[data-contact-id="${contactId}"]`);
        if (contactElement) {
            let unreadElement = contactElement.querySelector('.unread-count');
            let currentCount = unreadElement ? parseInt(unreadElement.textContent) : 0;
            currentCount = Math.max(0, currentCount + change);

            if (currentCount > 0) {
                if (!unreadElement) {
                    unreadElement = document.createElement('span');
                    unreadElement.className = 'unread-count';
                    contactElement.appendChild(unreadElement);
                }
                unreadElement.textContent = currentCount;
            } else if (unreadElement) {
                unreadElement.remove();
            }
        }
    }

    function updateLastMessage(data) {
        const contactId = data.sender_id === currentUserId ? data.contact_id : data.sender_id;
        const contactElement = document.querySelector(`.contact[data-contact-id="${contactId}"]`);

        if (contactElement) {
            const lastMessageElement = contactElement.querySelector('.last-message');
            if (lastMessageElement) {
                const prefix = data.sender_id === currentUserId ? 'You: ' : '';
                lastMessageElement.textContent = prefix + data.content.substring(0, 20) +
                    (data.content.length > 20 ? '...' : '');
            }
        }
    }

    function showNotification(message, type = 'success') {
        const notification = document.createElement('div');
        notification.className = `notification ${type}`;
        notification.textContent = message;
        document.body.appendChild(notification);

        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => notification.remove(), 300);
        }, 3000);
    }

    function selectContact(contactId, contactName, contactTag) {
        if (currentContactId === contactId) return;

        currentContactId = contactId;
        currentContactName = contactName;
        currentContactTag = contactTag;

        elements.chatWith.textContent = `Chat with ${contactName} ${contactTag}`;
        elements.messageInput.style.display = 'flex';
        elements.messagesContainer.innerHTML = '';
        elements.messageText.focus();

        // Load message history
        getMessageHistory(contactId);

        // Update active contact in UI
        document.querySelectorAll('.contact').forEach(c => c.classList.remove('active'));
        document.querySelector(`.contact[data-contact-id="${contactId}"]`).classList.add('active');

        // Mark messages as read
        markAsRead(contactId);
        updateUnreadCount(contactId, 0);

        // Subscribe to this contact's messages
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'subscribe',
                contact_id: contactId
            }));
        }
    }

    // Message Functions
function sendMessage() {
    const content = elements.messageText.value.trim();

    if (!content) {
        showNotification('Message cannot be empty', 'error');
        return;
    }

    if (!currentContactId) {
        showNotification('Select a contact first', 'error');
        return;
    }

    // Блокируем интерфейс во время отправки
    elements.sendBtn.disabled = true;
    elements.messageText.disabled = true;
    elements.sendBtn.innerHTML = '<div class="spinner"></div>';

    const message = {
        type: 'send_message',
        contact_id: currentContactId,
        content: content
    };

    // Очищаем поле ввода сразу
    elements.messageText.value = '';

    if (socket && socket.readyState === WebSocket.OPEN) {
        try {
            socket.send(JSON.stringify(message));
            // Оптимистичное обновление только после успешной отправки
            displayOptimisticMessage(content);
        } catch (e) {
            console.error('WebSocket send error:', e);
            showNotification('Failed to send message', 'error');
        } finally {
            resetSendButton();
        }
    } else {
        // Fallback на HTTP
        fetch('/api/send_message', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(message)
        })
        .then(response => {
            if (!response.ok) throw new Error('Network response was not ok');
            return response.json();
        })
        .then(data => {
            if (data.status === 'success') {
                displayOptimisticMessage(content);
            } else {
                throw new Error(data.message || 'Error sending message');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            showNotification(error.message, 'error');
        })
        .finally(() => {
            resetSendButton();
        });
    }
}



function displayOptimisticMessage(content) {
    const tempMsg = {
        id: 'temp-' + Date.now(),
        sender_id: currentUserId,
        sender_name: 'You',
        content: content,
        timestamp: new Date().toISOString(),
        is_read: false,
        contact_id: currentContactId
    };
    displayMessage(tempMsg);
    updateLastMessage(tempMsg);
}

function resetSendButton() {
    elements.sendBtn.disabled = false;
    elements.messageText.disabled = false;
    elements.sendBtn.innerHTML = '➤';
    elements.messageText.focus();
}

    function getMessageHistory(contactId) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'get_history',
                contact_id: contactId
            }));
        } else {
            // HTTP fallback
            fetch(`/api/get_history/${contactId}`)
                .then(response => response.json())
                .then(data => {
                    handleMessageHistory({
                        type: 'message_history',
                        contact_id: contactId,
                        messages: data
                    });
                })
                .catch(error => {
                    console.error('Error getting message history:', error);
                });
        }
    }

    function markAsRead(contactId) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({
                type: 'mark_as_read',
                contact_id: contactId
            }));
        } else {
            // HTTP fallback
            fetch('/api/mark_read', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    contact_id: contactId
                })
            });
        }
    }

    // Contact Functions
    function searchUsers() {
        const query = elements.searchInput.value.trim();
        if (query.length < 2) {
            elements.searchResults.style.display = 'none';
            return;
        }

        fetch(`/search_users?query=${encodeURIComponent(query)}`)
            .then(response => response.json())
            .then(users => {
                elements.searchResults.innerHTML = '';

                if (users.length > 0) {
                    users.forEach(user => {
                        const userElement = document.createElement('div');
                        userElement.classList.add('user-result');
userElement.innerHTML = `
    <span>${user.username} <span class="user-tag">${user.tag}</span></span>
    <button class="add-user-btn" 
            data-user-id="${user.id}"
            data-username="${user.username}"
            data-tag="${user.tag}">
        Add
    </button>
`;
                        elements.searchResults.appendChild(userElement);
                    });
                    elements.searchResults.style.display = 'block';
                } else {
                    elements.searchResults.style.display = 'none';
                }
            })
            .catch(error => {
                console.error('Search error:', error);
                elements.searchResults.style.display = 'none';
            });
    }

function addContact(userId, username, tag) {
    fetch('/add_friend', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `friend_id=${userId}`
    })
    .then(response => response.json())
    .then(data => {
        if (data.status === 'success') {
            const contactElement = document.createElement('div');
            contactElement.className = 'contact';
            contactElement.dataset.contactId = data.contact.id;
            contactElement.dataset.contactName = data.contact.username;
            contactElement.dataset.contactTag = data.contact.tag;
            contactElement.innerHTML = `
                <span class="online-status offline"></span>
                <span class="contact-name">${data.contact.username}</span>
                <span class="contact-tag">${data.contact.tag}</span>
                <div class="last-message"></div>
            `;

            contactElement.addEventListener('click', () => {
                selectContact(data.contact.id, data.contact.username, data.contact.tag);
            });

            elements.contactsContainer.appendChild(contactElement);

            elements.modal.style.display = 'none';
            elements.searchInput.value = '';
            elements.searchResults.style.display = 'none';

            showNotification(`Contact ${data.contact.username} added successfully!`);
        } else {
            showNotification(data.message || 'Error adding contact', 'error');
        }
    })
    .catch(error => {
        console.error('Add contact error:', error);
        showNotification('Error adding contact', 'error');
    });
}

    // Utility Functions
    function debounce(func, wait) {
        let timeout;
        return function() {
            const context = this, args = arguments;
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                func.apply(context, args);
            }, wait);
        };
    }

    function setupVisibilityHandler() {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible' &&
                (!socket || socket.readyState !== WebSocket.OPEN)) {
                console.log('Page became visible - reconnecting WebSocket');
                connectWebSocket();
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);

        // For mobile apps
        document.addEventListener('resume', () => {
            console.log('App resumed - reconnecting WebSocket');
            connectWebSocket();
        }, false);

        window.addEventListener('focus', () => {
            console.log('Window focused - checking WebSocket');
            if (!socket || socket.readyState !== WebSocket.OPEN) {
                connectWebSocket();
            }
        });
    }

    function setupMobileOptimizations() {
        // Track user activity to prevent sleep
        const updateLastAction = () => {
            lastActionTime = Date.now();
        };

        document.addEventListener('touchstart', updateLastAction);
        document.addEventListener('scroll', updateLastAction);
        document.addEventListener('click', updateLastAction);
        document.addEventListener('keypress', updateLastAction);

        // Periodically send activity
        setInterval(() => {
            if (Date.now() - lastActionTime > 10000 && socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({ type: 'ping' }));
            }
        }, 5000);
    }

    // Добавим обработчики для изменения тега
document.getElementById('change-tag-btn').addEventListener('click', function() {
    document.getElementById('change-tag-modal').style.display = 'block';
    document.getElementById('new-tag-input').focus();
});

document.querySelector('#change-tag-modal .close').addEventListener('click', function() {
    document.getElementById('change-tag-modal').style.display = 'none';
});


    function setupBeforeUnload() {
        window.addEventListener('beforeunload', () => {
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.close(1000, 'User navigated away');
            }
        });
    }

    // Initialization
    connectWebSocket();
    setupVisibilityHandler();
    setupMobileOptimizations();
    setupBeforeUnload();

    // Event Listeners
    elements.addContactBtn.addEventListener('click', () => {
        elements.modal.style.display = 'block';
        elements.searchInput.focus();
    });

    elements.closeBtn.addEventListener('click', () => {
        elements.modal.style.display = 'none';
        elements.searchResults.style.display = 'none';
    });

    window.addEventListener('click', (e) => {
        if (e.target === elements.modal) {
            elements.modal.style.display = 'none';
            elements.searchResults.style.display = 'none';
        }
    });

    elements.searchInput.addEventListener('input', debounce(searchUsers, 300));

elements.searchResults.addEventListener('click', (e) => {
    if (e.target.classList.contains('add-user-btn')) {
        const userId = e.target.dataset.userId;
        const username = e.target.dataset.username;
        const tag = e.target.dataset.tag;
        addContact(userId, username, tag);
    }
});
// Replace both contact selection event listeners with this single one
elements.contactsContainer.addEventListener('click', (e) => {
    const contactElement = e.target.closest('.contact');
    if (contactElement) {
        const contactId = parseInt(contactElement.dataset.contactId);
        const contactName = contactElement.dataset.contactName;
        const contactTag = contactElement.dataset.contactTag;

        selectContact(contactId, contactName, contactTag);
    }
});

    elements.sendBtn.addEventListener('click', sendMessage);
    elements.messageText.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            sendMessage();
        }
    });

    // Initialize existing contacts
    document.querySelectorAll('.contact').forEach(contact => {
        contact.addEventListener('click', function() {
            const contactId = this.dataset.contactId;
            const contactText = this.textContent.trim();
            const contactParts = contactText.split('#');
            const contactName = contactParts[0].trim();
            const contactTag = '#' + contactParts[1].trim();

            selectContact(contactId, contactName, contactTag);
        });
    });
});
