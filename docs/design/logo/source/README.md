# Logo sources

Scripts that draw the DevTalk logo (made with the logo-design skill):

- `build.py` draws the round-1 concepts into `../concepts/`.
- `final.py` draws the kit masters for the chosen direction (the pencil duck) into `../kit/`.
- `textpath.py` outlines "DevTalk" in Public Sans Bold, using the font's own kerning, from `node_modules/@fontsource-variable/public-sans`. It needs fontTools and brotli.

To rebuild, run `python3 docs/design/logo/source/final.py`.
