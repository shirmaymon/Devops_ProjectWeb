# Devops_ProjectWeb

VM Calculator Dashboard: a web app that calculates how many physical servers are needed to run a set of virtual machines.

Deployment (Dockerfiles and Kubernetes files) is in a separate repo: https://github.com/shirmaymon/Devops_Infra

## What it does

You describe three things, and the app places the virtual machines on the servers:

1. **Servers**: host types, each with CPU cores, memory (GB), storage (GB) and a server count.
2. **User populations**: groups of users, each with a user count.
3. **Virtual machines**: VM types, each with CPU, memory and storage. Each VM type is assigned to one or more populations, and its VM count is the sum of those populations.

The calculation runs in the browser. Each host keeps 80% of its CPU and memory (rounded down). Every host type is expanded into individual servers, and each VM is placed on the first server that has enough CPU, memory and storage. VMs that do not fit are reported as missing resources.

The data is kept in the browser session. Saving to and loading from the server needs a logged-in user (a local account with email and password). The backend stores the data as JSON in PostgreSQL: up to 5 saved files per user, and when the limit is reached the user is asked to delete the oldest one. The calculator itself works without logging in.

## Repo structure

| Path | What it is |
| --- | --- |
| `index.html` | Home page: counts of server, population and VM types, Start Planning, Load Example Data, Save and Load, and the menu to the other pages. |
| `servers.html` | Step 1: add, edit and delete server types. |
| `users.html` | Step 2: add, edit and delete user populations. |
| `machines.html` | Step 3: add, edit and delete VM types, and assign populations to them. |
| `calculator.html` | Runs the calculation and shows the result: placed and unplaced VMs, servers used, remaining resources per server. |
| `showdelete.html` | Shows all the data in the session and deletes it. It does not delete files saved on the server. |
| `css/style.css` | Styles shared by all pages. |
| `js/app.js` | Shared helpers: toast messages, active menu link, form validation. |
| `js/data.js` | Session data (hosts, users, machines), the example data, and the placement calculation. |
| `js/auth.js` | Login state: asks the server who is logged in, keeps the CSRF token in memory, and sends it with every request that changes data. |
| `js/saveload.js` | Save and Load in the browser: calls the backend API and downloads or uploads JSON files. |
| `login.html` | Log in and create-an-account page. |
| `api.py` | Flask backend (port 5000): saves, lists, loads, downloads and deletes the user's saved files in the table `saved_files`. Every route needs a logged-in user. |
| `auth.py` | Flask auth service (port 5001): register, login, logout and "who am I", under `/api/auth`. Passwords are hashed with Argon2id. |
| `common.py` | Used by `api.py` and `auth.py`: database connection, login sessions and the `login_required` check. |
| `DEPRECATED/` | Old files that are no longer used (for example `vmcalc.conf`, the old single-container Apache configuration). |

## Backend API (`api.py`)

All routes need a logged-in user. Routes that change data also need the CSRF token.

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/save` | Saves a file. Returns 409 (`limit_reached`) if the user already has 5 files. |
| `POST` | `/api/save/force` | Deletes the named file and saves the new one. |
| `GET` | `/api/files` | Lists the logged-in user's saved files. |
| `GET` | `/api/files/load` | Returns the JSON of a saved file. |
| `GET` | `/api/files/download` | Downloads a saved file. |
| `DELETE` | `/api/files/delete` | Deletes a saved file. |

## Auth API (`auth.py`)

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/auth/register` | Creates an account (email, name, password of 8 to 128 characters) and logs the user in. |
| `POST` | `/api/auth/login` | Checks the password and starts a new session. |
| `POST` | `/api/auth/logout` | Deletes the session on the server and clears the cookie. |
| `GET` | `/api/auth/me` | Returns the logged-in user and the CSRF token of the session. |

## How login works

The browser holds a random session ID in a cookie (`HttpOnly`, `SameSite=Strict`). The session record is stored in the PostgreSQL table `sessions`, and only a SHA-256 hash of the ID is stored. `auth.py` and `api.py` both read that table, so any pod can check a session, and logout takes effect at once because the server deletes the record. Every request that changes data must also send the session's CSRF token in the `X-CSRF-Token` header.

Settings (environment variables): `COOKIE_SECURE` (`true` once the site runs over HTTPS, default `false`), `SESSION_IDLE_MINUTES` (default 30) and `SESSION_ABSOLUTE_HOURS` (default 8), plus the database settings `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD`.

## Running it

The frontend calls the backend at the relative path `/api`, so the pages and the API must be served from the same address: a reverse proxy, or the Kubernetes Ingress in the infra repo. Both services need a PostgreSQL database with the schema from `init.sql` (in the infra repo), configured with the environment variables above.