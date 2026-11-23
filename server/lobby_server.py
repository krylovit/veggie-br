# Veggie BR lobby relay — rooms, host election, start countdown, message
# relay between the authoritative host client and the rest.
# Protocol (JSON):
#   C->S  join   {t:'join', room, name}
#   S->C  joined {t:'joined', id, room, host, players:[{id,name}], startAt}
#   S->*  lobby  {t:'lobby', players, host, startAt}
#   S->*  start  {t:'start', seed, host, players}
#   C->S  input  {t:'input', seq, inp}            -> host only
#   C->S  snap   {t:'snap', s}                    -> all except sender
#   C->S  leave  {t:'leave'}
#   S->*  peerLeft {t:'peerLeft', id, name}
#   S->*  host   {t:'host', id}                   on host migration
#   S->C  err    {t:'err', msg}
import asyncio
import json
import os
import random
import time

import websockets

HOST = os.environ.get('LOBBY_HOST', '127.0.0.1')
PORT = int(os.environ.get('LOBBY_PORT', '8791'))
LOBBY_SECONDS = float(os.environ.get('LOBBY_SECONDS', '60'))
MAX_ROOM = 8

rooms = {}                  # code -> Room
next_pid = [1]


class Room:
    def __init__(self, code):
        self.code = code
        self.players = {}   # id -> {ws, name, joined}
        self.host = None
        self.start_at = None
        self.started = False
        self.task = None
        self.seed = random.randrange(1, 2**31)

    def roster(self):
        return [{'id': pid, 'name': p['name']} for pid, p in self.players.items()]

    async def broadcast(self, msg, exclude=None):
        dead = []
        for pid, p in self.players.items():
            if pid == exclude:
                continue
            try:
                await p['ws'].send(json.dumps(msg))
            except Exception:
                dead.append(pid)
        return dead

    async def broadcast_lobby(self):
        await self.broadcast({
            't': 'lobby',
            'players': self.roster(),
            'host': self.host,
            'startAt': self.start_at,
        })


async def start_room(room):
    try:
        await asyncio.sleep(max(0, room.start_at - time.time()))
        if room.started or not room.players:
            return
        room.started = True
        await room.broadcast({
            't': 'start',
            'seed': room.seed,
            'host': room.host,
            'players': room.roster(),
        })
    except asyncio.CancelledError:
        pass


async def handle(ws):
    pid = None
    room = None
    try:
        async for raw in ws:
            try:
                m = json.loads(raw)
            except Exception:
                continue
            t = m.get('t')

            if t == 'join':
                if pid is not None:
                    continue
                code = str(m.get('room') or '')[:8].strip() or 'main'
                name = str(m.get('name') or 'Игрок')[:14].strip() or 'Игрок'
                room = rooms.get(code)
                if room is None:
                    room = rooms[code] = Room(code)
                    room.start_at = time.time() + LOBBY_SECONDS
                    room.task = asyncio.create_task(start_room(room))
                if room.started:
                    await ws.send(json.dumps({'t': 'err', 'msg': 'match already started'}))
                    continue
                if len(room.players) >= MAX_ROOM:
                    await ws.send(json.dumps({'t': 'err', 'msg': 'room is full'}))
                    continue
                pid = next_pid[0]
                next_pid[0] += 1
                room.players[pid] = {'ws': ws, 'name': name, 'joined': time.time()}
                if room.host is None:
                    room.host = pid
                await ws.send(json.dumps({
                    't': 'joined', 'id': pid, 'room': code,
                    'host': room.host, 'players': room.roster(),
                    'startAt': room.start_at,
                }))
                await room.broadcast_lobby()

            elif t == 'input' and room and pid is not None:
                # client -> host relay
                host = room.players.get(room.host)
                if host and room.host != pid:
                    try:
                        await host['ws'].send(json.dumps(
                            {'t': 'input', 'from': pid, 'inp': m.get('inp')}))
                    except Exception:
                        pass

            elif t == 'snap' and room and pid == room.host:
                await room.broadcast({'t': 'snap', 's': m.get('s')}, exclude=pid)

            elif t == 'relay' and room and pid is not None:
                await room.broadcast({'t': 'relay', 'from': pid, 'd': m.get('d')},
                                     exclude=pid)

            elif t == 'leave' and room and pid is not None:
                break
    finally:
        if room and pid is not None and pid in room.players:
            name = room.players[pid]['name']
            del room.players[pid]
            if room.players:
                if room.host == pid:
                    # promote the earliest-remaining member
                    room.host = min(room.players, key=lambda p: room.players[p]['joined'])
                    await room.broadcast({'t': 'host', 'id': room.host})
                await room.broadcast({'t': 'peerLeft', 'id': pid, 'name': name})
                if not room.started:
                    await room.broadcast_lobby()
            else:
                if room.task:
                    room.task.cancel()
                rooms.pop(room.code, None)


async def main():
    async with websockets.serve(handle, HOST, PORT, ping_interval=20,
                                ping_timeout=40):
        print(f'veggie-lobby on ws://{HOST}:{PORT}', flush=True)
        await asyncio.Future()


if __name__ == '__main__':
    asyncio.run(main())
