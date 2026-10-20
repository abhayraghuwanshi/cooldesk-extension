"""Convert the safe subset of Adblock Plus lists (EasyList/EasyPrivacy) into a
WebKit content-blocker JSON list.

Kept (exactly translatable):
  ||domain^[$opts]          -> block, url-filter on host, opts in TYPE_MAP / third-party
  @@||domain^[$opts]        -> ignore-previous-rules for that host
  @@||domain^$document      -> ignore-previous-rules for pages on that domain
  ##sel  /  a.com,b.com##sel -> css-display-none (selectors without ':' only,
                                since one selector WebKit rejects fails the list)
Everything else is dropped.

usage: python3 -I abp2webkit.py OUT.json LIST.txt [LIST.txt ...]

Refresh the bundled list (src-tauri/resources/adblock-rules.json):
  curl -sSfLo /tmp/easylist.txt https://easylist.to/easylist/easylist.txt
  curl -sSfLo /tmp/easyprivacy.txt https://easylist.to/easylist/easyprivacy.txt
  python3 -I scripts/abp2webkit.py src-tauri/resources/adblock-rules.json /tmp/easylist.txt /tmp/easyprivacy.txt
WebKit caps one list at 150k rules; the app recompiles automatically when the
file's contents change.
"""
import json
import re
import sys

TYPE_MAP = {
    "script": "script", "image": "image", "stylesheet": "style-sheet",
    "font": "font", "media": "media", "subdocument": "document",
    "xmlhttprequest": "raw", "websocket": "raw", "ping": "raw", "other": "raw",
    "popup": "popup",
}
DOMAIN = re.compile(r"^[a-z0-9-]+(\.[a-z0-9-]+)+$")
NET = re.compile(r"^(@@)?\|\|([a-z0-9.-]+)\^(?:\$(.+))?$")
SAFE_SELECTOR = re.compile(r"^[A-Za-z0-9_\-#.\[\]=\"'^$*~ >+,|]+$")
CSS_CHUNK = 200


def host_filter(domain):
    return r"^[^:]+://+([^:/]+\.)?" + re.escape(domain).replace(r"\-", "-") + r"[:/]"


def parse_opts(raw):
    types, load, document = [], None, False
    for opt in (raw.split(",") if raw else []):
        if opt == "third-party":
            load = ["third-party"]
        elif opt in ("~third-party", "first-party"):
            load = ["first-party"]
        elif opt == "document":
            document = True
        elif opt in TYPE_MAP:
            types.append(TYPE_MAP[opt])
        else:
            return None  # domain=, redirect=, csp=, negated types... not translatable
    return types, load, document


def main(out_path, list_paths):
    blocks, exceptions, page_allow = [], [], set()
    generic_css, domain_css = [], {}
    seen = set()

    for path in list_paths:
        with open(path, encoding="utf-8", errors="ignore") as fh:
            for line in fh:
                line = line.strip()
                if not line or line.startswith(("!", "[")):
                    continue

                if "##" in line and "#@#" not in line and "#?#" not in line and "#$#" not in line:
                    domains, sel = line.split("##", 1)
                    if ":" in sel or not SAFE_SELECTOR.match(sel):
                        continue
                    if not domains:
                        generic_css.append(sel)
                        continue
                    ds = domains.split(",")
                    if all(DOMAIN.match(d) for d in ds):
                        domain_css.setdefault(tuple(sorted(ds)), []).append(sel)
                    continue

                m = NET.match(line)
                if not m or not DOMAIN.match(m.group(2)):
                    continue
                exception, domain, raw_opts = m.groups()
                opts = parse_opts(raw_opts)
                if opts is None:
                    continue
                types, load, document = opts
                if exception and document:
                    page_allow.add(domain)
                    continue
                if document:
                    continue
                trigger = {"url-filter": host_filter(domain)}
                if types:
                    trigger["resource-type"] = sorted(set(types))
                if load:
                    trigger["load-type"] = load
                key = (bool(exception), json.dumps(trigger, sort_keys=True))
                if key in seen:
                    continue
                seen.add(key)
                action = {"type": "ignore-previous-rules" if exception else "block"}
                (exceptions if exception else blocks).append({"trigger": trigger, "action": action})

    rules = list(blocks)
    generic_css = sorted(set(generic_css))
    for i in range(0, len(generic_css), CSS_CHUNK):
        rules.append({
            "trigger": {"url-filter": ".*"},
            "action": {"type": "css-display-none", "selector": ", ".join(generic_css[i:i + CSS_CHUNK])},
        })
    for ds, sels in sorted(domain_css.items()):
        sels = sorted(set(sels))
        for i in range(0, len(sels), CSS_CHUNK):
            rules.append({
                "trigger": {"url-filter": ".*", "if-domain": ["*" + d for d in ds]},
                "action": {"type": "css-display-none", "selector": ", ".join(sels[i:i + CSS_CHUNK])},
            })
    rules.extend(exceptions)
    for d in sorted(page_allow):
        rules.append({"trigger": {"url-filter": ".*", "if-domain": ["*" + d]},
                      "action": {"type": "ignore-previous-rules"}})

    with open(out_path, "w", encoding="utf-8") as fh:
        json.dump(rules, fh, separators=(",", ":"))
    print(f"block={len(blocks)} generic_css={len(generic_css)} domain_css_groups={len(domain_css)} "
          f"exceptions={len(exceptions)} page_allow={len(page_allow)} total_rules={len(rules)}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2:])
