#!/bin/bash

hyprctl devices -j |   
	jq -r '.keyboards[] | select(.name=="at-translated-set-2-keyboard") | .active_keymap' |
  head -n1 |
  cut -c1-2 |
  tr 'a-z' 'A-Z'
