# jarvis shell integration
# source this file in your shell rc to enable `jrv use` environment variable export.
#
#   source "/path/to/@aiszlab/jarvis/jarvis.sh"

jrv() {
  if [[ "$1" == "use" ]]; then
    eval "$(command jrv "$@")"
  else
    command jrv "$@"
  fi
}
