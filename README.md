# Tusk starter site

A small three-page business website (home, work, contact) in plain HTML and
CSS, already marked up for [Tusk CMS](https://tuskcms.com) so the client can
edit the words, photos and downloads on the live page and you keep the code.

No framework, no dependencies. Node 18+ for the build.

## Use it

1. **Use this template** (green button above) to make your own repo.
2. **Deploy it** on Vercel, Netlify or Cloudflare Pages. Build command
   `npm run build`, output `dist`. Without Tusk variables the build just
   copies `site/` to `dist/`, so the deploy works before Tusk is connected.

   [![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/emiledelarey/tusk-starter)
   [![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/emiledelarey/tusk-starter)

3. **Connect it to Tusk.** In Claude Code, Cursor, Codex or Windsurf with
   the [Tusk MCP](https://tuskcms.com/connect) added, say:

   > Connect this site to Tusk CMS.

   The agent registers the site, sets the three build variables on your host,
   creates the deploy hook, publishes once and checks it went live. No agent?
   Follow [tuskcms.com/connect](https://tuskcms.com/connect) by hand: it is
   a build token, three environment variables and a deploy hook.

4. **Invite the client** from the Tusk dashboard. They click the text on
   their live site, change it, press Publish.

Then make it their site: replace the copy in `site/`, swap the photos in
`site/assets/`, restyle `style.css`. Keep the `data-tusk` attributes on
anything the client should be able to edit; add them to anything new.

## Layout

```
site/                 the committed site: index.html, work/, contact/, style.css, assets/
build.mjs             node build.mjs -> dist/  (pulls from Tusk when TUSK_TOKEN is set)
serve.mjs             node serve.mjs -> http://localhost:4310, to look at dist/
vercel.json           outputDirectory dist, build "npm run build"
netlify.toml          the same for Netlify
```

## Build

```
TUSK_SITE=<site slug> TUSK_TOKEN=<build token> TUSK_URL=https://tuskcms.com node build.mjs
```

With the variables set the build downloads the site's published snapshot
(`GET /api/published/<slug>/snapshot?assets=1`), puts every photo and file
under `dist/assets/tusk/`, and fills the marked elements. Without them the
committed HTML is copied unchanged, so a build never fails because Tusk was
unreachable. The deployed site never calls Tusk at runtime.

## What is marked

Every editable element carries `data-tusk="page.field"`. Repeated things
(cards, a trust strip) are lists: `data-tusk-list="page.field"` on the
container, `data-tusk-item` on the template child, `data-tusk-field` on each
part.

| Page | Field | Element |
| --- | --- | --- |
| home | eyebrow, heading, lead | hero text |
| home | photos | hero photo (first), then the strip under it (the rest) |
| home | brochure | "Download our brochure" link |
| work | eyebrow, heading, lead | page head |
| work | projects (title, blurb, photo) | the project cards, `data-tusk-list="work.projects"` |
| contact | eyebrow, heading, lead, phone, email, emailNote, hours, address, photos | the contact page |
| globals | resellerBtn, exploreBtn, range, bandEyebrow, bandTitle, bandBtn | buttons and headings |
| globals | trust (value, label) | the strip under the hero, `data-tusk-list="globals.trust"` |

How marks work, for any site: [tuskcms.com/docs](https://tuskcms.com/docs).

## Licence

MIT. Use it for client work without attribution.
