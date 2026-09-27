# Заявка GGG OAuth для poe2-kit — заполняемый шаблон (ход-2)

> Кем подаётся: только владелец (нужна ваша учётка GGG и контактный email).
> Куда: https://www.pathofexile.com/developer (форма Apply for OAuth credentials)
> или письмом на oauth@grindinggear.com.
> После одобрения: полученный Client ID положить в env `POE2K_GGG_CLIENT_ID`
> (см. README «OAuth» / apps/mcp README). Client secret НЕ нужен — public client, PKCE.

## Данные приложения (сверено с кодом, packages/core/src/oauth.ts)

| Поле заявки | Значение | Откуда |
|---|---|---|
| Application name | `poe2-kit — Path of Exile 2 offline companion and price check` | — |
| Contact e-mail | *(ваш email владельца)* | — |
| Redirect URIs | `http://127.0.0.1:8080/callback` | oauth.ts:42 (`GGG_OAUTH_CALLBACK_PORT = 8080`) + :180, :301 |
| Client type | Public (desktop app, PKCE; без client_secret) | oauth.ts:10-12, 301-302 |
| Scopes | `account:profile account:characters` | oauth.ts:39 (`GGG_OAUTH_SCOPES`) |
| Platform | Windows desktop (Electron overlay + MCP server, локальное использование) | архитектура кита |

## Description (готовый текст на английском, copy-paste в форму/письмо)

> PoE2 Kit is a free, open-source (MIT) local companion tool for Path of Exile 2.
> It provides in-game price checking of items, build analysis, and passive tree
> lookups. All processing is local; the tool only reads public community APIs
> (poe.ninja, RePoE) and does not distribute or re-host any GGG data.
>
> We are requesting OAuth credentials to let users optionally view their own
> account profile and character list inside the tool (scopes: account:profile,
> account:characters). The application is a public desktop client using PKCE
> with a loopback redirect URI (http://127.0.0.1:8080/callback); no client
> secret is stored. Requests respect the documented rate limits, and no data
> is collected or shared with third parties.

## После одобрения

1. `setx POE2K_GGG_CLIENT_ID "<выданный ID>"` (или в `apps/mcp/start-mcp.bat`).
2. Проверка: тул `poe2_oauth_login` → браузер → код возвращается на
   `127.0.0.1:8080/callback` → `poe2_characters` отдаёт список персонажей.
3. Записать ID в журнал КУБ-2 (секретом ID не является для public client, но в
   git его не кладём — только env).

## Границы

- Не проверено: актуальный вид формы pathofexile.com/developer (текст выше —
  по состоянию документации GGG OAuth на общих основаниях); если поля формы
  отличаются — заполнить по смыслу, Redirect URI менять нельзя без правки
  `GGG_OAUTH_CALLBACK_PORT` в oauth.ts.
- Redirect URI `127.0.0.1` (не `localhost`) — так захардкожено в oauth.ts:180,301;
  регистрировать именно его.
