#!/bin/bash
hyprctl clients -j | jq -r '.[].class' | 
	wofi -d | {
		read -r class
		if [ -z $class ]; then
			echo ""
		else

	#	if {$class==""} {
	#	} else {
			hyprctl dispatch focuswindow class:$class
		fi
	#	}
}
