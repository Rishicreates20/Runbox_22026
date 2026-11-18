import socket
try:
    socket.socket()
    print("SOCKET-ALLOWED")
except PermissionError:
    print("EACCES")
