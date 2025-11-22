# C Online IDE (TinyCC/GCC + Node.js)

Simple web app to compile and run C code from your browser. The server compiles the code with TinyCC (`tcc`) if available, otherwise falls back to `gcc`. Execution is sandboxed only by a short timeout.

<img width="680" height="228" alt="image" src="https://github.com/user-attachments/assets/b1551909-1f52-4c5d-99f4-3d13460054dd" />

## Requirements

- Node.js 18+
- One of:
  - TinyCC (`tcc`) — recommended for fast compiles
  - GCC (`gcc`)

On Manjaro:

```bash
sudo pacman -S tcc   # or: sudo pacman -S gcc
```

Optionally, you can try installing `node-tinycc` to experiment with in-process compilation:

```bash
npm i node-tinycc --save-optional
```

Note: This repository currently uses CLI compilers via `child_process.spawn()` by default. If `node-tinycc` is installed and you want to wire it in, see `compileC()` in `server.js`.

## Install & Run

```bash
cd /home/luiz/Documentos/c_online_ide
npm install
npm start
```

Open `http://localhost:3000/` in your browser.

## How it works

- Frontend (`public/`) is a simple HTML page with a textarea, a terminal-like output, and buttons for Compile, Run, and Compile & Run.
- Backend (`server.js`) exposes:
  - `GET /api/session` — creates a new session and temp dir
  - `POST /api/compile` — compiles code for the session
  - `POST /api/run` — runs the last compiled program for the session
  - `POST /api/compile-run` — compiles then runs
- The server uses a short timeout (~4s) to kill long-running programs.

## Security notes

Executing arbitrary C is dangerous. This demo only applies a time limit and does not sandbox the process. For real deployments:

- Run in a container or VM sandbox with strict seccomp/AppArmor
- Drop privileges and isolate filesystem/network
- Enforce CPU/memory quotas and strict timeouts


