# SSH background colors — works in Konsole, Yakuake, kitty, alacritty, etc.
# Changes terminal background based on SSH destination, restores on disconnect.
# Define colors as "hostname_pattern:#RRGGBB"
_SSH_COLORS=(
    "homunculus*:#ffa1a1"
    "lovelace*:#c6ffd2"
    "*:#fffca6"
)

ssh() {
    local host=""
    for arg in "$@"; do
        [[ "$arg" != -* ]] && host="$arg"
    done
    host="${host##*@}"

    # Find matching color
    local color=""
    for entry in "${_SSH_COLORS[@]}"; do
        local pattern="${entry%:*}"
        local c="${entry##*:}"
        # shellcheck disable=SC2254
        case "$host" in $pattern) color="$c"; break ;; esac
    done

    # Query and save current background, then apply new one
    local saved_bg=""
    if [[ -n "$color" ]]; then
        local old_stty response
        old_stty=$(stty -g)
        stty raw -echo min 0 time 5
        printf '\x1b]11;?\x07' > /dev/tty
        response=$(dd bs=64 count=1 2>/dev/null < /dev/tty)
        stty "$old_stty"
        # Extract rgb:RRRR/GGGG/BBBB and convert to #RRGGBB
        if [[ "$response" =~ rgb:([0-9a-fA-F]+)/([0-9a-fA-F]+)/([0-9a-fA-F]+) ]]; then
            local r="${BASH_REMATCH[1]}" g="${BASH_REMATCH[2]}" b="${BASH_REMATCH[3]}"
            # Take first 2 hex digits (16-bit → 8-bit)
            saved_bg="#${r:0:2}${g:0:2}${b:0:2}"
        fi
        printf '\x1b]11;%s\x07' "$color"
    fi

    command ssh "$@"

    # Restore previous background
    if [[ -n "$saved_bg" ]]; then
        printf '\x1b]11;%s\x07' "$saved_bg"
    fi
}
