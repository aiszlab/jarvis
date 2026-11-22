# jarvis shell integration for Bash/Zsh.
# source "/path/to/@aiszlab/jarvis/jarvis.sh"

_jrv_nvm_checkout_locked() {
  local jrv_version="$1" jrv_force="$2" jrv_node="$3" jrv_cli="$4"
  local jrv_original jrv_target jrv_current
  . "$NVM_DIR/nvm.sh" --no-use || return $?
  command -v nvm >/dev/null 2>&1 || { printf '%s\n' 'Unable to load nvm-sh.' >&2; return 1; }
  jrv_original=$(nvm current) || return $?
  nvm install "$jrv_version" || return $?
  jrv_target=$(nvm version "$jrv_version") || return $?
  if ! [[ "$jrv_target" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    printf '%s\n' 'nvm did not resolve an exact Node version; cleanup cancelled.' >&2
    return 1
  fi
  nvm use "$jrv_target" || return $?
  jrv_current=$(nvm current) || return $?
  if [ "$jrv_current" != "$jrv_target" ]; then
    printf '%s\n' 'nvm did not activate the requested version; cleanup cancelled.' >&2
    return 1
  fi
  nvm alias default "$jrv_target" || return $?
  if [ "$jrv_force" = 1 ]; then
    JARVIS_NVM_SHELL=1 "$jrv_node" "$jrv_cli" nvm _prune "$jrv_original" || {
      printf '%s\n' 'Node checkout succeeded, but cleanup failed; retained files can be retried later.' >&2
      return 1
    }
  fi
}

_jrv_nvm_checkout() {
  local jrv_preflight jrv_version jrv_force=0 jrv_node jrv_cli jrv_arg jrv_result
  jrv_preflight=$(JARVIS_NVM_SHELL=1 command jrv "$@") || return $?
  case "$jrv_preflight" in
    JARVIS_NVM_CHECKOUT:*)
      jrv_version=${jrv_preflight%%$'\n'*}
      jrv_version=${jrv_version#JARVIS_NVM_CHECKOUT:}
      jrv_preflight=${jrv_preflight#*$'\n'}
      jrv_node=${jrv_preflight%%$'\n'*}
      jrv_cli=${jrv_preflight#*$'\n'}
      ;;
    *) printf '%s\n' "$jrv_preflight"; return 0 ;;
  esac
  for jrv_arg in "$@"; do
    [ "$jrv_arg" != --force ] || jrv_force=1
  done
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if ! command mkdir "$NVM_DIR/.jarvis-checkout.lock" 2>/dev/null; then
    printf '%s\n' 'Another Jarvis checkout is running, or a stale .jarvis-checkout.lock exists in NVM_DIR. Resolve it before retrying.' >&2
    return 1
  fi
  if _jrv_nvm_checkout_locked "$jrv_version" "$jrv_force" "$jrv_node" "$jrv_cli"; then
    jrv_result=0
  else
    jrv_result=$?
  fi
  command rmdir "$NVM_DIR/.jarvis-checkout.lock" || return 1
  return "$jrv_result"
}

jrv() {
  if [[ "${1-}" == "use" ]]; then
    eval "$(command jrv "$@")"
  elif [[ "${1-}" == "nvm" && "${2-}" == "checkout" ]]; then
    _jrv_nvm_checkout "$@"
  else
    command jrv "$@"
  fi
}
