#!/usr/bin/env bash
# utils.sh — Logging, state management, dry-run helpers

set -euo pipefail

# Colors (disabled if not a terminal)
if [[ -t 1 ]]; then
    RED='\033[0;31m'
    GREEN='\033[0;32m'
    YELLOW='\033[0;33m'
    BLUE='\033[0;34m'
    BOLD='\033[1m'
    NC='\033[0m' # No Color
else
    RED='' GREEN='' YELLOW='' BLUE='' BOLD='' NC=''
fi

# Globals (set by main script)
DRY_RUN="${DRY_RUN:-false}"
VERBOSE="${VERBOSE:-false}"
STATE_DIR="${STATE_DIR:-state}"
LOG_DIR="${LOG_DIR:-logs}"

#######################################
# Logging functions
#######################################

log_info() {
    echo -e "${BLUE}ℹ${NC} $*" >&2
}

log_success() {
    echo -e "${GREEN}✓${NC} $*" >&2
}

log_warn() {
    echo -e "${YELLOW}⚠${NC} $*" >&2
}

log_error() {
    echo -e "${RED}✗${NC} $*" >&2
}

log_debug() {
    if [[ "$VERBOSE" == "true" ]]; then
        echo -e "${BOLD}[DEBUG]${NC} $*" >&2
    fi
}

log_dry_run() {
    echo -e "${YELLOW}[DRY-RUN]${NC} Would: $*" >&2
}

#######################################
# Dry-run wrapper
#######################################

# Execute command or log if dry-run
run_cmd() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "$*"
        return 0
    else
        "$@"
    fi
}

# Execute gh command or log if dry-run
run_gh() {
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "gh $*"
        return 0
    else
        gh "$@"
    fi
}

#######################################
# State management
#######################################

init_state_dir() {
    mkdir -p "$STATE_DIR" "$LOG_DIR"
}

# Get state for a repo
# Usage: get_repo_state "owner/repo"
get_repo_state() {
    local repo="$1"
    local state_file="$STATE_DIR/operations.json"
    
    if [[ ! -f "$state_file" ]]; then
        echo "not_started"
        return
    fi
    
    jq -r --arg repo "$repo" '.repos[$repo].status // "not_started"' "$state_file"
}

# Set state for a repo
# Usage: set_repo_state "owner/repo" "status" ["pr_url"] ["sha"]
set_repo_state() {
    local repo="$1"
    local status="$2"
    local pr_url="${3:-}"
    local sha="${4:-}"
    local state_file="$STATE_DIR/operations.json"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "Set state: $repo -> $status"
        return 0
    fi
    
    # Initialize state file if needed
    if [[ ! -f "$state_file" ]]; then
        echo '{"run_id":"","repos":{}}' > "$state_file"
    fi
    
    # Update state
    local tmp_file
    tmp_file=$(mktemp)
    jq --arg repo "$repo" \
       --arg status "$status" \
       --arg pr_url "$pr_url" \
       --arg sha "$sha" \
       --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
       '.repos[$repo] = {status: $status, pr_url: $pr_url, sha: $sha, updated_at: $ts}' \
       "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
}

# Set run metadata
set_run_id() {
    local run_id="$1"
    local state_file="$STATE_DIR/operations.json"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        return 0
    fi
    
    if [[ ! -f "$state_file" ]]; then
        echo '{"run_id":"","repos":{}}' > "$state_file"
    fi
    
    local tmp_file
    tmp_file=$(mktemp)
    jq --arg run_id "$run_id" \
       --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
       '.run_id = $run_id | .started_at = $ts' \
       "$state_file" > "$tmp_file" && mv "$tmp_file" "$state_file"
}

#######################################
# Rollback script generation
#######################################

add_rollback_command() {
    local repo="$1"
    local pr_number="$2"
    local rollback_file="$STATE_DIR/rollback.sh"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        return 0
    fi
    
    if [[ ! -f "$rollback_file" ]]; then
        cat > "$rollback_file" << 'EOF'
#!/usr/bin/env bash
# Auto-generated rollback script
# Review before running!
set -euo pipefail

echo "This will revert the following PRs. Press Ctrl+C to abort."
read -p "Continue? [y/N] " -n 1 -r
echo
[[ $REPLY =~ ^[Yy]$ ]] || exit 1

EOF
        chmod +x "$rollback_file"
    fi
    
    echo "echo 'Reverting $repo PR #$pr_number'" >> "$rollback_file"
    echo "gh pr close $pr_number --repo '$repo' --comment 'Reverted by gh-bump rollback' || true" >> "$rollback_file"
}

#######################################
# Per-repo logging
#######################################

get_repo_log_file() {
    local repo="$1"
    local safe_name="${repo//\//_}"
    echo "$LOG_DIR/${safe_name}.log"
}

log_to_repo() {
    local repo="$1"
    shift
    local log_file
    log_file=$(get_repo_log_file "$repo")
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] $*" >> "$log_file"
}

#######################################
# Summary report
#######################################

generate_report() {
    local state_file="$STATE_DIR/operations.json"
    
    if [[ ! -f "$state_file" ]]; then
        log_warn "No state file found"
        return
    fi
    
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "                      gh-bump Summary Report"
    echo "═══════════════════════════════════════════════════════════════"
    echo ""
    
    local run_id started_at
    run_id=$(jq -r '.run_id // "unknown"' "$state_file")
    started_at=$(jq -r '.started_at // "unknown"' "$state_file")
    
    echo "Run ID:     $run_id"
    echo "Started:    $started_at"
    echo "Completed:  $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
    echo ""
    
    # Count statuses
    local total merged failed skipped pr_created
    total=$(jq '.repos | length' "$state_file")
    merged=$(jq '[.repos[] | select(.status == "merged")] | length' "$state_file")
    pr_created=$(jq '[.repos[] | select(.status == "pr_created")] | length' "$state_file")
    failed=$(jq '[.repos[] | select(.status | test("failed|error"))] | length' "$state_file")
    skipped=$(jq '[.repos[] | select(.status == "skipped")] | length' "$state_file")
    
    echo "Results:"
    echo "  Total repos:    $total"
    echo "  Merged:         $merged"
    echo "  PRs created:    $pr_created"
    echo "  Failed:         $failed"
    echo "  Skipped:        $skipped"
    echo ""
    
    # List failures if any
    if [[ "$failed" -gt 0 ]]; then
        echo "Failed repos:"
        jq -r '.repos | to_entries[] | select(.value.status | test("failed|error")) | "  - \(.key): \(.value.status)"' "$state_file"
        echo ""
    fi
    
    echo "State file: $state_file"
    echo "Logs dir:   $LOG_DIR"
    if [[ -f "$STATE_DIR/rollback.sh" ]]; then
        echo "Rollback:   $STATE_DIR/rollback.sh"
    fi
    echo ""
}

#######################################
# Pattern matching
#######################################

# Check if repo matches pattern
# Usage: repo_matches_pattern "owner/repo" "owner/prefix"
repo_matches_pattern() {
    local repo="$1"
    local pattern="$2"
    
    # Empty pattern matches all
    if [[ -z "$pattern" ]]; then
        return 0
    fi
    
    # Glob-style prefix match
    [[ "$repo" == $pattern* ]]
}

#######################################
# Prerequisites check
#######################################

check_prerequisites() {
    local missing=()
    
    if ! command -v gh &> /dev/null; then
        missing+=("gh (GitHub CLI)")
    fi
    
    if ! command -v jq &> /dev/null; then
        missing+=("jq")
    fi
    
    if [[ ${#missing[@]} -gt 0 ]]; then
        log_error "Missing required tools:"
        for tool in "${missing[@]}"; do
            echo "  - $tool"
        done
        echo ""
        echo "Install with:"
        echo "  brew install gh jq"
        exit 1
    fi
    
    # Check gh auth
    if ! gh auth status &> /dev/null; then
        log_error "Not authenticated with GitHub CLI"
        echo "Run: gh auth login"
        exit 1
    fi
    
    log_debug "Prerequisites check passed"
}
