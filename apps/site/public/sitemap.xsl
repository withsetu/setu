<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:s="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
  <xsl:output method="html" encoding="UTF-8" indent="yes" doctype-system="about:legacy-compat"/>

  <xsl:template match="/">
    <html lang="en">
      <head>
        <meta charset="utf-8"/>
        <meta name="viewport" content="width=device-width, initial-scale=1"/>
        <meta name="robots" content="noindex, follow"/>
        <title>XML Sitemap · Setu</title>
        <style>
          :root {
            --bg: #f7f8fa; --card: #ffffff; --ink: #1a1c23; --muted: #6b7280;
            --border: #e6e8ec; --accent: #4f46e5; --accent-soft: #eef2ff;
          }
          @media (prefers-color-scheme: dark) {
            :root { --bg:#0d0f14; --card:#151822; --ink:#e8eaf0; --muted:#9aa2b1;
                    --border:#232838; --accent:#8b8bff; --accent-soft:#1b1f30; }
          }
          * { box-sizing: border-box; }
          body {
            margin: 0; background: var(--bg); color: var(--ink);
            font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          }
          .wrap { max-width: 1000px; margin: 0 auto; padding: 40px 20px 64px; }
          header { display: flex; align-items: center; gap: 12px; margin-bottom: 6px; }
          .logo {
            width: 34px; height: 34px; border-radius: 9px; flex: none;
            background: var(--accent); color: #fff; display: grid; place-items: center;
            font-weight: 700; font-size: 18px;
          }
          h1 { font-size: 22px; margin: 0; letter-spacing: -0.01em; }
          .lede { color: var(--muted); margin: 4px 0 24px; max-width: 60ch; }
          .count {
            display: inline-block; background: var(--accent-soft); color: var(--accent);
            border-radius: 999px; padding: 3px 12px; font-size: 13px; font-weight: 600;
            margin-bottom: 18px;
          }
          .card {
            background: var(--card); border: 1px solid var(--border); border-radius: 14px;
            overflow: hidden; box-shadow: 0 1px 2px rgba(0,0,0,0.04);
          }
          table { width: 100%; border-collapse: collapse; }
          th, td { text-align: left; padding: 12px 18px; }
          thead th {
            font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em;
            color: var(--muted); border-bottom: 1px solid var(--border); font-weight: 600;
          }
          tbody tr { border-top: 1px solid var(--border); }
          tbody tr:first-child { border-top: 0; }
          tbody tr:hover { background: var(--accent-soft); }
          td a { color: var(--accent); text-decoration: none; word-break: break-all; }
          td a:hover { text-decoration: underline; }
          .num { text-align: right; color: var(--muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
          .date { color: var(--muted); white-space: nowrap; font-variant-numeric: tabular-nums; }
          footer { margin-top: 28px; color: var(--muted); font-size: 13px; }
          footer a { color: var(--accent); text-decoration: none; font-weight: 600; }
          footer a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="wrap">
          <header>
            <div class="logo">S</div>
            <h1>XML Sitemap</h1>
          </header>

          <!-- Sitemap INDEX -->
          <xsl:if test="s:sitemapindex">
            <p class="lede">This is a sitemap index — it lists the sub-sitemaps search engines
              (Google, Bing) use to discover every page on this site.</p>
            <div class="count"><xsl:value-of select="count(s:sitemapindex/s:sitemap)"/> sitemaps</div>
            <div class="card">
              <table>
                <thead>
                  <tr><th>Sitemap</th><th class="date">Last modified</th></tr>
                </thead>
                <tbody>
                  <xsl:for-each select="s:sitemapindex/s:sitemap">
                    <tr>
                      <td><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
                      <td class="date"><xsl:value-of select="substring(s:lastmod, 1, 10)"/></td>
                    </tr>
                  </xsl:for-each>
                </tbody>
              </table>
            </div>
          </xsl:if>

          <!-- URL sitemap -->
          <xsl:if test="s:urlset">
            <xsl:variable name="hasImages" select="count(s:urlset/s:url/image:image) &gt; 0"/>
            <p class="lede">This sitemap lists the URLs on this site available for crawling.</p>
            <div class="count"><xsl:value-of select="count(s:urlset/s:url)"/> URLs</div>
            <div class="card">
              <table>
                <thead>
                  <tr>
                    <th>URL</th>
                    <xsl:if test="$hasImages"><th class="num">Images</th></xsl:if>
                    <th class="date">Last modified</th>
                  </tr>
                </thead>
                <tbody>
                  <xsl:for-each select="s:urlset/s:url">
                    <tr>
                      <td><a href="{s:loc}"><xsl:value-of select="s:loc"/></a></td>
                      <xsl:if test="$hasImages">
                        <td class="num"><xsl:value-of select="count(image:image)"/></td>
                      </xsl:if>
                      <td class="date"><xsl:value-of select="substring(s:lastmod, 1, 10)"/></td>
                    </tr>
                  </xsl:for-each>
                </tbody>
              </table>
            </div>
          </xsl:if>

          <footer>
            Generated by <a href="https://setu.build" target="_blank" rel="noopener">Setu</a> — the
            Git-native CMS.
          </footer>
        </div>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
