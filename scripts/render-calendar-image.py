#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
from datetime import datetime, timedelta
from calendar import monthrange

from PIL import Image, ImageDraw, ImageFont


def bj_today():
    return (datetime.utcnow() + timedelta(hours=8)).date()


def fmt(d):
    return d.strftime("%Y-%m-%d")


def load_json(url):
    with urllib.request.urlopen(url, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def key(a):
    return "|".join(
        [
            a.get("name") or "",
            a.get("startDate") or "",
            a.get("endDate") or "",
            a.get("source") or "",
            a.get("category") or "",
        ]
    )


def build_period_map(activities):
    by_name = {}
    for a in activities:
        n = a.get("name") or ""
        if not n:
            continue
        by_name.setdefault(n, []).append(a)
    out = {}
    for _, lst in by_name.items():
        lst = sorted(
            lst,
            key=lambda x: (
                x.get("startDate") or "9999-99-99",
                x.get("endDate") or x.get("startDate") or "9999-99-99",
            ),
        )
        if len(lst) <= 1:
            continue
        for i, a in enumerate(lst, start=1):
            out[key(a)] = i
    return out


def title(a, period_map):
    n = a.get("name") or ""
    p = period_map.get(key(a))
    return f"{n}（第{p}期）" if p else n


def parse_date(s):
    return datetime.strptime(s, "%Y-%m-%d").date()


def event_on_day(a, day):
    if not a.get("startDate"):
        return False
    s = parse_date(a.get("startDate"))
    e = parse_date(a.get("endDate") or a.get("startDate"))
    return s <= day <= e


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/opt/gng-activity-calendar/public/generated/calendar-push-latest.png"
    api_url = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000/api/calendar"

    data = load_json(api_url)
    acts = data.get("activities", [])
    today = bj_today()
    today_s = fmt(today)

    def valid(a):
        ts = a.get("types") or []
        return a.get("startDate") and ts and ("未配置" not in ts)

    active = sorted(
        [a for a in acts if valid(a) and event_on_day(a, today)],
        key=lambda x: (x.get("endDate") or x.get("startDate") or ""),
    )
    upcoming = sorted(
        [a for a in acts if valid(a) and (a.get("startDate") or "") > today_s],
        key=lambda x: x.get("startDate") or "",
    )[:6]

    period_map = build_period_map(acts)

    W, H = 1600, 980
    img = Image.new("RGB", (W, H), (14, 18, 30))
    draw = ImageDraw.Draw(img)

    bg_map = "/opt/gng-activity-calendar/public/images/bg-map.png"
    if os.path.exists(bg_map):
        bg = Image.open(bg_map).convert("RGB").resize((W, H))
        img.paste(bg, (0, 0))
        overlay = Image.new("RGBA", (W, H), (10, 14, 24, 168))
        img = Image.alpha_composite(img.convert("RGBA"), overlay).convert("RGB")
        draw = ImageDraw.Draw(img)

    fn = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
    fb = "/usr/share/fonts/opentype/noto/NotoSerifCJK-Bold.ttc"
    ft_title = ImageFont.truetype(fb, 58)
    ft_h = ImageFont.truetype(fb, 38)
    ft = ImageFont.truetype(fn, 28)
    ft_sm = ImageFont.truetype(fn, 22)

    draw.text((42, 28), "GNG活动日历", font=ft_title, fill=(242, 247, 255))
    draw.text((44, 104), today_s, font=ft_sm, fill=(171, 190, 224))

    # Calendar panel (left)
    cx, cy, cw, ch = 40, 150, 560, 780
    draw.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=24, fill=(19, 24, 40, 220), outline=(66, 80, 120))
    y, m = today.year, today.month
    draw.text((cx + 24, cy + 22), f"{y}年{m}月", font=ft_h, fill=(134, 201, 255))

    week = ["一", "二", "三", "四", "五", "六", "日"]
    for i, wd in enumerate(week):
        draw.text((cx + 28 + i * 76, cy + 88), wd, font=ft_sm, fill=(170, 186, 214))

    first_w = (datetime(y, m, 1).weekday())  # Mon=0
    days = monthrange(y, m)[1]

    # count events per day
    per_day = {}
    for d in range(1, days + 1):
        day = datetime(y, m, d).date()
        per_day[d] = sum(1 for a in acts if valid(a) and event_on_day(a, day))

    for d in range(1, days + 1):
        idx = first_w + (d - 1)
        row = idx // 7
        col = idx % 7
        x = cx + 22 + col * 76
        yy = cy + 132 + row * 96
        box = (x, yy, x + 64, yy + 76)
        if d == today.day:
            draw.rounded_rectangle(box, radius=14, fill=(129, 91, 224))
        elif per_day[d] > 0:
            draw.rounded_rectangle(box, radius=14, fill=(40, 49, 74))
        else:
            draw.rounded_rectangle(box, radius=14, fill=(28, 35, 57))
        draw.text((x + 20, yy + 16), str(d), font=ft_sm, fill=(238, 244, 255))
        if per_day[d] > 0:
            draw.text((x + 16, yy + 44), str(per_day[d]), font=ft_sm, fill=(124, 224, 170))

    # Right panel lists
    rx, ry, rw, rh = 630, 150, 930, 780
    draw.rounded_rectangle((rx, ry, rx + rw, ry + rh), radius=24, fill=(19, 24, 40, 220), outline=(66, 80, 120))

    y0 = ry + 28
    draw.text((rx + 24, y0), f"正在进行 ({len(active)})", font=ft_h, fill=(112, 232, 181))
    y0 += 58
    for a in active[:8]:
        s = a.get("startDate") or "?"
        e = a.get("endDate") or a.get("startDate") or "?"
        nm = title(a, period_map)
        draw.rounded_rectangle((rx + 18, y0 - 8, rx + rw - 18, y0 + 34), radius=12, fill=(31, 40, 64))
        draw.text((rx + 34, y0), nm, font=ft, fill=(236, 243, 255))
        draw.text((rx + rw - 18 - 310, y0), f"{s} ~ {e}", font=ft_sm, fill=(171, 188, 220))
        y0 += 50

    y0 += 22
    draw.text((rx + 24, y0), f"即将开始 ({len(upcoming)})", font=ft_h, fill=(132, 199, 255))
    y0 += 58
    for a in upcoming:
        s = a.get("startDate") or "?"
        e = a.get("endDate") or a.get("startDate") or "?"
        nm = title(a, period_map)
        draw.rounded_rectangle((rx + 18, y0 - 8, rx + rw - 18, y0 + 34), radius=12, fill=(31, 40, 64))
        draw.text((rx + 34, y0), nm, font=ft, fill=(236, 243, 255))
        draw.text((rx + rw - 18 - 310, y0), f"{s} ~ {e}", font=ft_sm, fill=(171, 188, 220))
        y0 += 50

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.save(out_path, "PNG")
    print(json.dumps({"ok": True, "out_path": out_path, "bytes": os.path.getsize(out_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()

