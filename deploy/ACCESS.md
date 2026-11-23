# Доступы для деплоя (копия из D:\servercontrol\KapitanPihlo_bot_new)

## GitHub

- Юзер: `krylovit`
- Репо пушатся по HTTPS, креды в Git Credential Manager (helper=manager) — `git push` работает без интерактива.
- Формат remote: `https://github.com/krylovit/<repo>.git`
- GitHub Pages: Settings → Pages → Deploy from branch `main` (root) — или через API `POST /repos/krylovit/<repo>/pages`.

## Сервер .57 («ai», kapitanpiho.duckdns.org)

- SSH: `ssh -p 48133 -i C:\Users\ktulhu.PARNAS\.ssh\id_cascade_ktulhu ktulhu@109.167.229.57`
- Парольный вход отключён — только ключ. sudo требует пароль — вводит юзер руками (`ssh -t`).
- Caddy на 80/443: HTTPS + reverse proxy, домен `kapitanpiho.duckdns.org`
- Docker `test3dweb` (nginx:alpine, порт 8471, restart unless-stopped) раздаёт
  `/mnt/ton-data/test3dweb/` (ro-mount) → `https://kapitanpiho.duckdns.org/game3d/`
- Деплой статики: `scp -P 48133 -i <ключ> -r <папка>/* ktulhu@109.167.229.57:/mnt/ton-data/test3dweb/<имя>/`
- ВНИМАНИЕ: `/mnt/ton-data` принадлежит `ton` — новые подпапки в test3dweb могут требовать sudo.

## Грабли

- Кириллицу НЕ передавать аргументами в scp/ssh — теряются байты. Пути/скрипты — латиницей, .sh-файлы UTF-8 заливать scp и исполнять `bash ~/script.sh`.
- Sudo на сервере: только `ssh -t` (TTY для пароля).
