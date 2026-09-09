#!/usr/bin/env python3
"""格物 · 大模型知识库 — 应用服务器

静态站点 + 账号体系（邮箱注册/登录）+ 用户数据隔离（收藏/标注/书签）+ 管理员面板数据。
存储：SQLite（_raw/app.db）。密码：werkzeug PBKDF2 哈希。
运行：python3 app.py [端口]（默认 8686）
"""
import json
import os
import re
import sqlite3
import time
import urllib.request

from flask import Flask, g, jsonify, request, send_from_directory, session
from werkzeug.security import check_password_hash, generate_password_hash

BASE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(BASE, "_raw", "app.db")
# 公开部署前请通过环境变量覆盖默认值：GEWU_ADMIN_EMAIL / GEWU_ADMIN_PASS / GEWU_SECRET
ADMIN_EMAIL = os.environ.get("GEWU_ADMIN_EMAIL", "1499502690@qq.com")
ADMIN_PASS = os.environ.get("GEWU_ADMIN_PASS", "zh13246570")
SECRET = os.environ.get("GEWU_SECRET", "gewu-local-secret-2026")

app = Flask(__name__, static_folder=None)
app.secret_key = SECRET
app.config["SESSION_COOKIE_HTTPONLY"] = True
app.config["SESSION_COOKIE_SAME_SITE"] = "Lax"

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ---------------- db ----------------
def db():
    if "db" not in g:
        g.db = sqlite3.connect(DB)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(_exc):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_db():
    os.makedirs(os.path.dirname(DB), exist_ok=True)
    conn = sqlite3.connect(DB)
    conn.executescript("""
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      pass_hash TEXT NOT NULL,
      is_admin INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      reg_ip TEXT,
      reg_loc TEXT,
      ua TEXT
    );
    CREATE TABLE IF NOT EXISTS user_data (
      user_id INTEGER NOT NULL,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, key)
    );
    """)
    row = conn.execute("SELECT id FROM users WHERE email=?", (ADMIN_EMAIL,)).fetchone()
    if not row:
        conn.execute(
            "INSERT INTO users(email, pass_hash, is_admin, created_at, reg_ip, reg_loc, ua) VALUES(?,?,1,?,?,?,?)",
            (ADMIN_EMAIL, generate_password_hash(ADMIN_PASS),
             time.strftime("%Y-%m-%d %H:%M:%S"), "seed", "预置管理员", "system"),
        )
    conn.commit()
    conn.close()


# ---------------- helpers ----------------
def client_ip():
    xf = request.headers.get("X-Forwarded-For", "")
    if xf:
        return xf.split(",")[0].strip()
    return request.remote_addr or "unknown"


def ip_location(ip):
    if not ip or ip.startswith(("127.", "::1", "unknown")):
        return "本地"
    try:
        url = f"http://ip-api.com/json/{ip}?fields=country,regionName,city&lang=zh-CN&timeout=3"
        with urllib.request.urlopen(url, timeout=3.5) as r:
            d = json.loads(r.read().decode("utf-8"))
        parts = [d.get(k) for k in ("country", "regionName", "city") if d.get(k)]
        return " ".join(parts) if parts else "未知"
    except Exception:
        return "未知"


def current_user():
    uid = session.get("uid")
    if not uid:
        return None
    row = db().execute("SELECT id, email, is_admin FROM users WHERE id=?", (uid,)).fetchone()
    return dict(row) if row else None


def require_auth():
    u = current_user()
    if not u:
        return None, (jsonify({"ok": False, "err": "未登录"}), 401)
    return u, None


# ---------------- 静态站点 ----------------
@app.route("/")
def index():
    return send_from_directory(BASE, "index.html")


@app.route("/<path:path>")
def static_files(path):
    full = os.path.join(BASE, path)
    if os.path.isdir(full):
        path = os.path.join(path, "index.html")
    return send_from_directory(BASE, path)


# ---------------- 认证 ----------------
@app.post("/api/register")
def register():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not EMAIL_RE.match(email):
        return jsonify({"ok": False, "err": "邮箱格式不正确"}), 400
    if len(password) < 6:
        return jsonify({"ok": False, "err": "密码至少 6 位"}), 400
    conn = db()
    if conn.execute("SELECT id FROM users WHERE email=?", (email,)).fetchone():
        return jsonify({"ok": False, "err": "该邮箱已注册"}), 409
    ip = client_ip()
    loc = ip_location(ip)
    cur = conn.execute(
        "INSERT INTO users(email, pass_hash, is_admin, created_at, reg_ip, reg_loc, ua) VALUES(?,?,0,?,?,?,?)",
        (email, generate_password_hash(password), time.strftime("%Y-%m-%d %H:%M:%S"),
         ip, loc, (request.headers.get("User-Agent") or "")[:200]),
    )
    conn.commit()
    session["uid"] = cur.lastrowid
    return jsonify({"ok": True, "user": {"email": email, "is_admin": False}})


@app.post("/api/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    row = db().execute("SELECT id, pass_hash, is_admin FROM users WHERE email=?", (email,)).fetchone()
    if not row or not check_password_hash(row["pass_hash"], password):
        return jsonify({"ok": False, "err": "邮箱或密码错误"}), 401
    session["uid"] = row["id"]
    return jsonify({"ok": True, "user": {"email": email, "is_admin": bool(row["is_admin"])}})


@app.post("/api/logout")
def logout():
    session.clear()
    return jsonify({"ok": True})


@app.get("/api/me")
def me():
    u = current_user()
    if not u:
        return jsonify({"ok": False}), 401
    return jsonify({"ok": True, "user": u})


# ---------------- 用户数据（收藏/标注/书签） ----------------
DATA_KEYS = {"fav", "notes", "bookmark"}


@app.get("/api/data/<key>")
def get_data(key):
    if key not in DATA_KEYS:
        return jsonify({"ok": False, "err": "bad key"}), 400
    u, err = require_auth()
    if err:
        return err
    row = db().execute("SELECT value FROM user_data WHERE user_id=? AND key=?", (u["id"], key)).fetchone()
    return jsonify({"ok": True, "value": json.loads(row["value"]) if row else None})


@app.put("/api/data/<key>")
def put_data(key):
    if key not in DATA_KEYS:
        return jsonify({"ok": False, "err": "bad key"}), 400
    u, err = require_auth()
    if err:
        return err
    value = request.get_json(silent=True)
    db().execute(
        "INSERT INTO user_data(user_id, key, value, updated_at) VALUES(?,?,?,?) "
        "ON CONFLICT(user_id, key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
        (u["id"], key, json.dumps(value, ensure_ascii=False), time.strftime("%Y-%m-%d %H:%M:%S")),
    )
    db().commit()
    return jsonify({"ok": True})


# ---------------- 管理员面板 ----------------
@app.get("/api/admin/stats")
def admin_stats():
    u, err = require_auth()
    if err:
        return err
    if not u["is_admin"]:
        return jsonify({"ok": False, "err": "无权限"}), 403
    conn = db()
    users = [dict(r) for r in conn.execute(
        "SELECT id, email, is_admin, created_at, reg_ip, reg_loc FROM users ORDER BY id DESC").fetchall()]
    notes_n = conn.execute("SELECT COUNT(*) c FROM user_data WHERE key='notes'").fetchone()["c"]
    favs_n = conn.execute("SELECT COUNT(*) c FROM user_data WHERE key='fav'").fetchone()["c"]
    per_user = {r["user_id"]: r for r in conn.execute(
        "SELECT user_id, key, value FROM user_data").fetchall()}
    user_notes = {}
    for uid, row in per_user.items():
        if row["key"] == "notes":
            try:
                user_notes[uid] = len(json.loads(row["value"]))
            except Exception:
                user_notes[uid] = 0
    total_notes = sum(user_notes.values())
    return jsonify({
        "ok": True,
        "total_users": len(users),
        "total_notes": total_notes,
        "users_with_notes": notes_n,
        "users_with_favs": favs_n,
        "users": [{**x, "notes": user_notes.get(x["id"], 0)} for x in users],
    })


# ---------------- 管理员用户管理 ----------------
@app.delete("/api/admin/users/<int:uid>")
def admin_delete_user(uid):
    """删除注册用户（连带其云端数据）。管理员账号不可删除。"""
    u, err = require_auth()
    if err:
        return err
    if not u["is_admin"]:
        return jsonify({"ok": False, "err": "无权限"}), 403
    conn = db()
    row = conn.execute("SELECT id, is_admin FROM users WHERE id=?", (uid,)).fetchone()
    if not row:
        return jsonify({"ok": False, "err": "用户不存在"}), 404
    if row["is_admin"]:
        return jsonify({"ok": False, "err": "不能删除管理员账号"}), 400
    conn.execute("DELETE FROM user_data WHERE user_id=?", (uid,))
    conn.execute("DELETE FROM users WHERE id=?", (uid,))
    conn.commit()
    return jsonify({"ok": True, "deleted": uid})


@app.post("/api/admin/users/<int:uid>/reset_pass")
def admin_reset_pass(uid):
    """重置指定用户的密码（由管理员设定新密码）。"""
    u, err = require_auth()
    if err:
        return err
    if not u["is_admin"]:
        return jsonify({"ok": False, "err": "无权限"}), 403
    new_pass = ((request.get_json(silent=True) or {}).get("pass") or "").strip()
    if len(new_pass) < 6:
        return jsonify({"ok": False, "err": "新密码至少 6 位"}), 400
    conn = db()
    if not conn.execute("SELECT id FROM users WHERE id=?", (uid,)).fetchone():
        return jsonify({"ok": False, "err": "用户不存在"}), 404
    conn.execute("UPDATE users SET pass_hash=? WHERE id=?", (generate_password_hash(new_pass), uid))
    conn.commit()
    return jsonify({"ok": True})


@app.post("/api/admin/users/<int:uid>/clear_data")
def admin_clear_data(uid):
    """清空指定用户的云端数据（收藏/标注/书签）。"""
    u, err = require_auth()
    if err:
        return err
    if not u["is_admin"]:
        return jsonify({"ok": False, "err": "无权限"}), 403
    conn = db()
    if not conn.execute("SELECT id FROM users WHERE id=?", (uid,)).fetchone():
        return jsonify({"ok": False, "err": "用户不存在"}), 404
    conn.execute("DELETE FROM user_data WHERE user_id=?", (uid,))
    conn.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    port = int(__import__("sys").argv[1]) if len(__import__("sys").argv) > 1 else 8686
    print(f"格物知识库已启动: http://127.0.0.1:{port}  (账号体系已启用)", flush=True)
    app.run(host="127.0.0.1", port=port, threaded=True)
