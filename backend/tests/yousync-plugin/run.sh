#!/bin/bash
# Lance le banc du plugin yousync dans un conteneur PHP jetable sur le VPS (pas de PHP
# sur le Mac). Le script arrive par l'entrée standard, rien n'est déposé, aucune base
# réelle n'est touchée : SQLite en mémoire. Version de PHP en argument, 7.4 par défaut.
PHP_VERSION="${1:-7.4}"
cd "$(dirname "$0")/../../.." || exit 1
python3 - <<'PY' | ssh youvape "docker run --rm -i php:${PHP_VERSION}-cli php"
import base64, json, re
sources = [open(f'yousync/includes/class-{n}.php', encoding='utf-8').read() for n in ['install', 'auth', 'queue']]
sources.append("""<?php
namespace YouSync;
class Data_Fetcher {
    public static function get($type, $id) {
        $key = $type . ':' . $id;
        if (!array_key_exists($key, $GLOBALS['content'])) { return null; }
        if ($GLOBALS['content'][$key] === 'THROW') { throw new \\RuntimeException('boom'); }
        return $GLOBALS['content'][$key];
    }
}
""")
sources.append(open('yousync/includes/class-rest.php', encoding='utf-8').read())
blob = base64.b64encode(json.dumps(sources).encode()).decode()
harness = open('backend/tests/yousync-plugin/harness.php', encoding='utf-8').read()
print(harness.replace("base64_decode(getenv('YOUSYNC_SOURCES') ?: stream_get_contents(fopen('php://fd/3', 'r')))", f"base64_decode('{blob}')"))
PY
