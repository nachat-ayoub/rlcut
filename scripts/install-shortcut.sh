#!/usr/bin/env bash
# Install a user-owned app-menu shortcut; no sudo or system-wide changes.
set -euo pipefail
project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
[[ -x "$project/dist/rlcut" ]] || { echo 'Build rlcut first.' >&2; exit 1; }
python3 - "$project" <<'PY'
import os, pathlib, sys
project=pathlib.Path(sys.argv[1])
folder=pathlib.Path(os.environ.get('XDG_DATA_HOME',str(pathlib.Path.home()/'.local/share')))/'applications'
folder.mkdir(parents=True,exist_ok=True)
def quote(value):
    return '"'+str(value).replace('\\','\\\\\\\\').replace('"','\\\\"').replace('`','\\\\`').replace('$','\\\\$')+'"'
entry=folder/'rlcut.desktop'
entry.write_text('[Desktop Entry]\nType=Application\nName=rlcut\nComment=Rocket League Shorts\nExec='+quote(project/'dist/rlcut')+'\nIcon='+str(project/'src-tauri/icons/128x128@2x.png')+'\nTerminal=false\nCategories=AudioVideo;Video;\nStartupWMClass=rlcut\n')
entry.chmod(0o755)
print('App-menu shortcut installed: '+str(entry))
PY
