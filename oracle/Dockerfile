# Окружение headless-оракула PoB2 (alpine — то же, что в CI самого PoB2).
# LuaJIT + luautf8 (C-модуль), git (клон PoB2), node (сверка golden).
# Сборка через devcontainer-куб SourceCraft CI (.sourcecraft/ci.yaml).
FROM alpine:3.18

RUN apk add --no-cache \
    luajit luarocks luajit-dev build-base \
    git nodejs unzip curl

# luautf8 собирается под LuaJIT (Lua 5.1-совместимый): указываем заголовки luajit.
RUN luarocks --lua-version=5.1 LUA_INCDIR=/usr/include/luajit-2.1 install luautf8

WORKDIR /workspace
