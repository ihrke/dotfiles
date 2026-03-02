# >>> conda initialize >>>
# !! Contents within this block are managed by 'conda init' !!
__conda_setup="$('/home/mmi041/miniconda3/bin/conda' 'shell.bash' 'hook' 2> /dev/null)"
if [ $? -eq 0 ]; then
    eval "$__conda_setup"
else
    if [ -f "/home/mmi041/miniconda3/etc/profile.d/conda.sh" ]; then
        . "/home/mmi041/miniconda3/etc/profile.d/conda.sh"
    else
        export PATH="/home/mmi041/miniconda3/bin:$PATH"
    fi
fi
unset __conda_setup
# <<< conda initialize <<<

# FSL Setup
FSLDIR=/home/mmi041/fsl
PATH=${FSLDIR}/share/fsl/bin:${PATH}
export FSLDIR PATH
. ${FSLDIR}/etc/fslconf/fsl.sh

export FREESURFER_HOME=/usr/local/freesurfer
source $FREESURFER_HOME/SetUpFreeSurfer.sh

## Added by SimNIBS
SIMNIBS_BIN="/home/mmi041/SimNIBS-4.5/bin"
export PATH=${PATH}:${SIMNIBS_BIN}

# Stata
export PATH=${PATH}:/opt/stata:$HOME/MATLAB/R2025a/bin

# Cursor CLI
export PATH="$HOME/.local/bin:$PATH"

export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion
