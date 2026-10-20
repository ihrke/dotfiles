#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."   # workspace root
 
# Claude Code permission mode (used by the VS Code extension; the shell
# launchers pass --permission-mode auto): write USER-scope
# settings for both account dirs so the sandbox starts in auto mode. Both dirs
# are persistent volumes. Only create the file if absent so login/session data
# and hand-edited settings are never clobbered.
for CLAUDE_DIR in "$HOME/.claude" "$HOME/.claude-sci"; do
    SETTINGS="$CLAUDE_DIR/settings.json"
    if [ ! -f "$SETTINGS" ]; then
        echo ">> Writing $SETTINGS (auto mode)"
        mkdir -p "$CLAUDE_DIR"
        cat > "$SETTINGS" <<'JSON'
{
  "$schema": "https://json.schemastore.org/claude-code-settings.json",
  "permissions": {
    "defaultMode": "auto"
  }
}
JSON
    fi
done

# System packages: reinstall anything recorded in apt-packages.txt.
# (Lines starting with # and blank lines are ignored.)
if [ -f apt-packages.txt ]; then
    pkgs=$(grep -vE '^[[:space:]]*(#|$)' apt-packages.txt | tr '\n' ' ')
    if [ -n "${pkgs// /}" ]; then
        echo ">> Reinstalling apt packages from apt-packages.txt"
        sudo apt-get update
        sudo apt-get install -y --no-install-recommends $pkgs
        sudo rm -rf /var/lib/apt/lists/*
    fi
fi
 
# Python: recreate/refresh the conda env from environment.yml if present.
if [ -f environment.yml ]; then
    echo ">> Restoring conda env from environment.yml"
    source /opt/conda/etc/profile.d/conda.sh
    conda env create -f environment.yml 2>/dev/null \
        || conda env update -f environment.yml --prune
fi
 
# R: restore packages from the pak lockfile if present.
if [ -f pkg.lock ]; then
    echo ">> Restoring R packages from pkg.lock"
    Rscript -e 'pak::lockfile_install("pkg.lock")'
fi