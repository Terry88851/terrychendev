# terrychendev

Personal portfolio site. Plain HTML/CSS/JS, no build step.

- `index.html` — page markup
- `css/style.css` — styles
- `js/blackhole.js` — the WebGL front-page scene: a singularity that collapses as you scroll, explodes, and becomes Gargantua

Run locally:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

Frozen-frame preview params (handy for screenshots):

- `?prog=0.5` — singularity at 50% collapse
- `?boom=1.2` — 1.2 s after the explosion (`?boom=5` = settled Gargantua)
- `?still=6` — freeze the animation clock at 6 s (combine with the above)
