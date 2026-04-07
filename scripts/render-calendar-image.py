#!/usr/bin/env python3
import json
import os
import sys
import urllib.request
from collections import deque
from datetime import datetime, timedelta
from calendar import monthrange

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFont, ImageFilter


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


def pick_font(candidates, size):
    for f in candidates:
        if os.path.exists(f):
            return ImageFont.truetype(f, size)
    return ImageFont.load_default()


def ellipsize(draw, text, font, max_width):
    if draw.textlength(text, font=font) <= max_width:
        return text
    suffix = "..."
    out = text
    while out and draw.textlength(out + suffix, font=font) > max_width:
        out = out[:-1]
    return (out + suffix) if out else suffix


def soften_white_edge(img):
    """Remove near-white matte around PNG character art."""
    px = img.load()
    w, h = img.size
    for yy in range(h):
        for xx in range(w):
            r, g, b, a = px[xx, yy]
            if a == 0:
                continue
            if r > 245 and g > 245 and b > 245:
                px[xx, yy] = (r, g, b, 0)
            elif r > 228 and g > 228 and b > 228:
                px[xx, yy] = (r, g, b, int(a * 0.35))
    return img


def soften_black_matte(img):
    """Remove black matte connected to image border only."""
    px = img.load()
    w, h = img.size
    visited = [[False] * w for _ in range(h)]
    q = deque()

    def blackish(xx, yy, thr):
        r, g, b, a = px[xx, yy]
        return a > 0 and r < thr and g < thr and b < thr

    for xx in range(w):
        if blackish(xx, 0, 52):
            q.append((xx, 0))
        if blackish(xx, h - 1, 52):
            q.append((xx, h - 1))
    for yy in range(h):
        if blackish(0, yy, 52):
            q.append((0, yy))
        if blackish(w - 1, yy, 52):
            q.append((w - 1, yy))

    while q:
        xx, yy = q.popleft()
        if xx < 0 or xx >= w or yy < 0 or yy >= h or visited[yy][xx]:
            continue
        if not blackish(xx, yy, 52):
            continue
        visited[yy][xx] = True
        r, g, b, a = px[xx, yy]
        if r < 26 and g < 26 and b < 26:
            px[xx, yy] = (r, g, b, 0)
        else:
            px[xx, yy] = (r, g, b, int(a * 0.28))
        q.append((xx + 1, yy))
        q.append((xx - 1, yy))
        q.append((xx, yy + 1))
        q.append((xx, yy - 1))
    return img


def feather_alpha_edges(img, border=24, opacity=0.78):
    """Feather image edges to avoid visible rectangular boundary."""
    w, h = img.size
    m = Image.new("L", (w, h), 255)
    dm = ImageDraw.Draw(m)
    dm.rectangle((0, 0, w - 1, h - 1), fill=255)
    for i in range(border):
        val = int(255 * (i + 1) / (border + 1))
        dm.rectangle((i, i, w - 1 - i, h - 1 - i), outline=val)
    m = m.filter(ImageFilter.GaussianBlur(8))
    a = img.split()[3]
    a = a.point(lambda p: int(p * opacity))
    a = ImageChops.multiply(a, m)
    img.putalpha(a)
    return img


def draw_badge(draw, text, font, x, y, fill_color, text_color=(255, 255, 255), padding_x=12, padding_y=5):
    """Draw a rounded pill-shaped badge and return its width."""
    text_w = draw.textlength(text, font=font)
    badge_w = int(text_w) + padding_x * 2
    badge_h = int(font.size) + padding_y * 2
    draw.rounded_rectangle(
        (x, y, x + badge_w, y + badge_h),
        radius=badge_h // 2,
        fill=fill_color,
    )
    draw.text((x + padding_x, y + padding_y), text, font=font, fill=text_color)
    return badge_w


def main():
    out_path = sys.argv[1] if len(sys.argv) > 1 else "/opt/gng-activity-calendar/public/generated/calendar-push-latest.png"
    api_url = sys.argv[2] if len(sys.argv) > 2 else "http://127.0.0.1:3000/api/calendar"
    web_url = sys.argv[3] if len(sys.argv) > 3 else "http://101.133.141.32"

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

    row_h = 52
    active_rows = min(len(active), 8)
    upcoming_rows = min(len(upcoming), 8)
    active_panel_h = 96 + active_rows * row_h
    upcoming_panel_h = 96 + upcoming_rows * row_h
    W, H = 1600, max(980, 180 + active_panel_h + 20 + upcoming_panel_h + 90)
    img = Image.new("RGBA", (W, H), (14, 18, 30, 255))
    draw = ImageDraw.Draw(img)

    bg_map = "/opt/gng-activity-calendar/public/images/bg-map.png"
    bg_character = "/opt/gng-activity-calendar/public/images/bg-character.png"
    if os.path.exists(bg_map):
        bg = Image.open(bg_map).convert("RGBA").resize((W, H))
        img.alpha_composite(bg, (0, 0))
        overlay = Image.new("RGBA", (W, H), (10, 16, 28, 34))
        img = Image.alpha_composite(img, overlay)
        draw = ImageDraw.Draw(img)
    if os.path.exists(bg_character):
        ch = Image.open(bg_character).convert("RGBA")
        ch = ch.resize((286, 372))
        ch = soften_white_edge(ch)
        ch = soften_black_matte(ch)
        ch = ImageEnhance.Brightness(ch).enhance(1.42)
        ch = ImageEnhance.Contrast(ch).enhance(1.10)
        ch = feather_alpha_edges(ch, border=6, opacity=0.99)
        ch = ch.filter(ImageFilter.UnsharpMask(radius=1.3, percent=190, threshold=2))
        img.alpha_composite(ch, (58, H - 426))
        draw = ImageDraw.Draw(img)

    sans_candidates = [
        "/usr/share/fonts/truetype/msttcorefonts/msyh.ttc",
        "/usr/share/fonts/truetype/msttcorefonts/MicrosoftYaHei.ttf",
        "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
        "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    ]
    ft_title = pick_font(sans_candidates, 48)
    ft_h = pick_font(sans_candidates, 27)
    ft = pick_font(sans_candidates, 21)
    ft_sm = pick_font(sans_candidates, 16)
    ft_link = pick_font(sans_candidates, 18)
    ft_mini = pick_font(sans_candidates, 14)
    ft_badge = pick_font(sans_candidates, 15)

    # ── Title ──────────────────────────────────────────────────────────────
    title_text = "GNG活动日历"
    title_bbox = draw.textbbox((0, 0), title_text, font=ft_title)
    title_w = title_bbox[2] - title_bbox[0]
    title_x = (W - title_w) // 2
    title_cy = 22 + (title_bbox[3] - title_bbox[1]) // 2 + 4

    # Decorative lines flanking the title
    line_y = title_cy
    draw.line([(60, line_y), (title_x - 24, line_y)], fill=(146, 176, 226, 180), width=2)
    draw.line([(title_x + title_w + 24, line_y), (W - 60, line_y)], fill=(146, 176, 226, 180), width=2)
    # Small diamond accents at line ends
    for lx in [title_x - 28, title_x + title_w + 28]:
        draw.polygon([(lx, line_y - 5), (lx + 5, line_y), (lx, line_y + 5), (lx - 5, line_y)], fill=(146, 176, 226, 200))

    draw.text((title_x, 22), title_text, font=ft_title, fill=(242, 247, 255))

    # ── Today badge ────────────────────────────────────────────────────────
    draw.rounded_rectangle((40, 96, 330, 138), radius=14, fill=(34, 48, 76, 100), outline=(146, 176, 226, 180), width=1)
    draw.text((58, 104), f"今日  {today_s}", font=ft_sm, fill=(200, 225, 255))

    # ── Calendar panel (left) ──────────────────────────────────────────────
    cx, cy, cw, ch = 40, 158, 300, 430
    draw.rounded_rectangle((cx, cy, cx + cw, cy + ch), radius=22, fill=(16, 28, 46, 90), outline=(118, 146, 194, 160), width=1)

    y, m = today.year, today.month
    cal_title = f"{y}年{m}月"
    cal_title_bbox = draw.textbbox((0, 0), cal_title, font=ft_h)
    cal_title_w = cal_title_bbox[2] - cal_title_bbox[0]
    draw.text((cx + (cw - cal_title_w) // 2, cy + 14), cal_title, font=ft_h, fill=(134, 201, 255))

    week = ["一", "二", "三", "四", "五", "六", "日"]
    for i, wd in enumerate(week):
        wc = (200, 180, 255) if i >= 5 else (188, 201, 226)
        draw.text((cx + 14 + i * 40, cy + 68), wd, font=ft_mini, fill=wc)

    first_w = datetime(y, m, 1).weekday()
    days = monthrange(y, m)[1]

    per_day = {}
    for d in range(1, days + 1):
        day = datetime(y, m, d).date()
        per_day[d] = sum(1 for a in acts if valid(a) and event_on_day(a, day))

    for d in range(1, days + 1):
        idx = first_w + (d - 1)
        row = idx // 7
        col = idx % 7
        x = cx + 12 + col * 40
        yy = cy + 94 + row * 52
        box = (x, yy, x + 34, yy + 42)
        if d == today.day:
            draw.rounded_rectangle(box, radius=10, fill=(140, 80, 240, 230))
            draw.rounded_rectangle(box, radius=10, outline=(255, 255, 255, 220), width=2)
        elif per_day[d] > 0:
            draw.rounded_rectangle(box, radius=10, fill=(36, 56, 86, 130))
        else:
            draw.rounded_rectangle(box, radius=10, fill=(24, 36, 58, 96), outline=(108, 136, 178, 70), width=1)

        num_color = (255, 255, 255) if d == today.day else (238, 244, 255)
        draw.text((x + 8, yy + 6), str(d), font=ft_mini, fill=num_color)

        # Event indicator dot
        if per_day[d] > 0 and d != today.day:
            dot_x = x + 20
            dot_y = yy + 30
            draw.ellipse((dot_x - 4, dot_y - 4, dot_x + 4, dot_y + 4), fill=(80, 230, 160, 255))

    # ── Right panels ────────────────────────────────────────────────────────
    rx, ry, rw = 360, 158, 1200
    active_h = active_panel_h
    upcoming_h = upcoming_panel_h

    draw.rounded_rectangle((rx, ry, rx + rw, ry + active_h), radius=24, fill=(16, 28, 46, 82), outline=(116, 152, 206, 150), width=1)
    draw.rounded_rectangle((rx, ry + active_h + 18, rx + rw, ry + active_h + 18 + upcoming_h), radius=24, fill=(16, 28, 46, 76), outline=(116, 152, 206, 140), width=1)

    # ── Active section header ──────────────────────────────────────────────
    y0 = ry + 26
    # Green accent square
    draw.rounded_rectangle((rx + 24, y0 + 3, rx + 35, y0 + 25), radius=3, fill=(80, 220, 160, 255))
    draw.text((rx + 44, y0), f"正在进行 ({len(active)})", font=ft_h, fill=(100, 235, 175))
    y0 += 64

    for a in active[:8]:
        s = a.get("startDate") or "?"
        e = a.get("endDate") or a.get("startDate") or "?"
        left_days = (parse_date(e) - today).days if e != "?" else None

        # Badge color by urgency
        if left_days is not None:
            if left_days <= 3:
                badge_fill = (210, 65, 65, 220)
            elif left_days <= 7:
                badge_fill = (220, 160, 40, 220)
            else:
                badge_fill = (50, 180, 120, 220)
            badge_text = f"还有{left_days}天结束"
        else:
            badge_fill = (80, 120, 180, 200)
            badge_text = "进行中"

        badge_w = int(draw.textlength(badge_text, font=ft_badge)) + 24
        badge_h_px = 26
        badge_x = rx + rw - 24 - badge_w
        badge_y = y0 + 9

        date_str = f"{s} ~ {e}"
        date_w = draw.textlength(date_str, font=ft_sm)
        date_x = int(badge_x - 16 - date_w)

        nm_max = max(240, date_x - (rx + 56) - 16)
        nm = ellipsize(draw, title(a, period_map), ft, nm_max)

        # Card background
        draw.rounded_rectangle((rx + 18, y0 - 6, rx + rw - 18, y0 + 46), radius=12, fill=(18, 30, 52, 96), outline=(124, 162, 228, 110), width=1)
        # Left accent strip
        draw.rounded_rectangle((rx + 18, y0 - 6, rx + 23, y0 + 46), radius=3, fill=(80, 220, 160, 200))

        draw.text((rx + 36, y0), nm, font=ft, fill=(238, 244, 255))
        draw.text((date_x, y0 + 4), date_str, font=ft_sm, fill=(180, 210, 255, 200))

        # Draw badge
        draw.rounded_rectangle((badge_x, badge_y, badge_x + badge_w, badge_y + badge_h_px), radius=badge_h_px // 2, fill=badge_fill)
        draw.text((badge_x + 12, badge_y + 5), badge_text, font=ft_badge, fill=(255, 255, 255))

        y0 += row_h

    # ── Upcoming section header ────────────────────────────────────────────
    y0 = ry + active_h + 16 + 18 + 26
    # Blue accent square
    draw.rounded_rectangle((rx + 24, y0 + 3, rx + 35, y0 + 25), radius=3, fill=(80, 170, 255, 255))
    draw.text((rx + 44, y0), f"即将开始 ({len(upcoming)})", font=ft_h, fill=(120, 190, 255))
    y0 += 64

    for a in upcoming[:8]:
        s = a.get("startDate") or "?"
        e = a.get("endDate") or a.get("startDate") or "?"
        to_start = (parse_date(s) - today).days if s != "?" else None

        if to_start is not None:
            badge_text = f"还有{to_start}天开始"
            badge_fill = (60, 130, 220, 220)
        else:
            badge_text = "即将"
            badge_fill = (60, 130, 220, 200)

        badge_w = int(draw.textlength(badge_text, font=ft_badge)) + 24
        badge_h_px = 26
        badge_x = rx + rw - 24 - badge_w
        badge_y = y0 + 9

        date_str = f"{s} ~ {e}"
        date_w = draw.textlength(date_str, font=ft_sm)
        date_x = int(badge_x - 16 - date_w)

        nm_max = max(240, date_x - (rx + 56) - 16)
        nm = ellipsize(draw, title(a, period_map), ft, nm_max)

        # Card background
        draw.rounded_rectangle((rx + 18, y0 - 6, rx + rw - 18, y0 + 46), radius=12, fill=(18, 30, 52, 90), outline=(120, 158, 222, 104), width=1)
        # Left accent strip
        draw.rounded_rectangle((rx + 18, y0 - 6, rx + 23, y0 + 46), radius=3, fill=(80, 170, 255, 200))

        draw.text((rx + 36, y0), nm, font=ft, fill=(236, 242, 255))
        draw.text((date_x, y0 + 4), date_str, font=ft_sm, fill=(160, 195, 240, 200))

        # Draw badge
        draw.rounded_rectangle((badge_x, badge_y, badge_x + badge_w, badge_y + badge_h_px), radius=badge_h_px // 2, fill=badge_fill)
        draw.text((badge_x + 12, badge_y + 5), badge_text, font=ft_badge, fill=(255, 255, 255))

        y0 += row_h

    # ── Footer link bar ─────────────────────────────────────────────────────
    draw.rounded_rectangle((40, H - 62, W - 40, H - 20), radius=14, fill=(18, 28, 44, 90), outline=(130, 168, 230, 160), width=1)
    link_text = f"网页日历：{web_url}  ↗"
    draw.text((56, H - 52), link_text, font=ft_link, fill=(160, 220, 255))

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    img.convert("RGB").save(out_path, "PNG")
    print(json.dumps({"ok": True, "out_path": out_path, "bytes": os.path.getsize(out_path)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
