# pages/

Per-navigation-page modules (`overview`, `franchise`, `direct`, `teams`, `details`, `rules`, `developer-docs`).

`profile-shared.mjs` contains shared franchise/direct profile helpers. `owner-review.mjs` is a teams submodule, not a separate nav page.

Dependency rule: page modules may import `components/`, `domain/`, `lib/`, and `dashboard/`; page modules should not import each other except for deliberate shared helpers such as `profile-shared.mjs`.
