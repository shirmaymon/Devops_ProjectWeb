# Devops_ProjectWeb

VM Calculator Dashboard: a web app that calculates how many physical servers are needed to run a set of virtual machines.

Deployment (Dockerfiles and Kubernetes files) is in a separate repo: https://github.com/shirmaymon/Devops_Infra

## What it does

You describe three things, and the app places the virtual machines on the servers:

1. **Servers**: host types, each with CPU cores, memory (GB), storage (GB) and a server count.
2. **User populations**: groups of users, each with a user count.
3. **Virtual machines**: VM types, each with CPU, memory and storage. Each VM type is assigned to one or more populations, and its VM count is the sum of those populations.

The calculation runs in the browser. Each host keeps 80% of its CPU and memory (rounded down). Every host type is expanded into individual servers, and each VM is placed on the first server that has enough CPU, memory and storage. VMs that do not fit are reported as missing resources.

The data is kept in the browser session. The backend saves and loads the data as JSON files: up to 5 saved files per user (identified by first and last name), and when the limit is reached the user is asked to delete the oldest one.

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
| `js/saveload.js` | Save and Load in the browser: calls the backend API and downloads or uploads JSON files. |
| `api.py` | Flask backend (port 5000): saves, lists, loads, downloads and deletes the JSON files under `/web-data/<first>_<last>/`. |
| `DEPRECATED/` | Old files that are no longer used (for example `vmcalc.conf`, the old single-container Apache configuration). |

## Backend API

| Method | Path | What it does |
| --- | --- | --- |
| `POST` | `/api/save` | Saves a file. Returns 409 (`limit_reached`) if the user already has 5 files. |
| `POST` | `/api/save/force` | Deletes the named file and saves the new one. |
| `GET` | `/api/files` | Lists the user's saved files. |
| `GET` | `/api/files/load` | Returns the JSON of a saved file. |
| `GET` | `/api/files/download` | Downloads a saved file. |
| `DELETE` | `/api/files/delete` | Deletes a saved file. |

## Running it

The frontend calls the backend at the relative path `/api`, so the pages and the API must be served from the same address: a reverse proxy, or the Kubernetes Ingress in the infra repo. The backend writes to `/web-data`, so that path needs a volume if the files must survive a restart.