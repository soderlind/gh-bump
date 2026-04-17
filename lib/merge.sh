#!/usr/bin/env bash
# merge.sh — CI polling + mergeability checks + auto-merge

set -euo pipefail

# Source utils if not already loaded
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true

#######################################
# Configuration
#######################################

CI_TIMEOUT="${CI_TIMEOUT:-1800}"        # 30 minutes default
CI_POLL_INTERVAL="${CI_POLL_INTERVAL:-30}"  # 30 seconds between polls

#######################################
# PR status checks
#######################################

# Get PR status details
# Returns JSON: {mergeable, mergeStateStatus, statusCheckRollup, reviewDecision}
get_pr_status() {
    local pr_url="$1"
    
    gh pr view "$pr_url" --json mergeable,mergeStateStatus,statusCheckRollup,reviewDecision 2>/dev/null || echo '{}'
}

# Check if PR is mergeable
# Returns: 0 if mergeable, 1 if not
is_pr_mergeable() {
    local pr_url="$1"
    
    local status
    status=$(get_pr_status "$pr_url")
    
    local mergeable merge_state
    mergeable=$(echo "$status" | jq -r '.mergeable // "UNKNOWN"')
    merge_state=$(echo "$status" | jq -r '.mergeStateStatus // "UNKNOWN"')
    
    log_debug "PR status: mergeable=$mergeable, mergeState=$merge_state"
    
    [[ "$mergeable" == "MERGEABLE" ]] && [[ "$merge_state" == "CLEAN" ]]
}

# Check if CI checks are complete (success or failure)
# Returns: 0 if complete, 1 if still pending
are_checks_complete() {
    local pr_url="$1"
    
    local status
    status=$(get_pr_status "$pr_url")
    
    # Get all check states
    local checks
    checks=$(echo "$status" | jq -r '.statusCheckRollup // []')
    
    if [[ "$checks" == "[]" ]] || [[ "$checks" == "null" ]]; then
        # No checks configured
        log_debug "No CI checks configured"
        return 0
    fi
    
    # Check if any are pending
    local pending
    pending=$(echo "$checks" | jq '[.[] | select(.status == "PENDING" or .status == "IN_PROGRESS" or .status == "QUEUED")] | length')
    
    [[ "$pending" -eq 0 ]]
}

# Check if all CI checks passed
# Returns: 0 if all passed, 1 if any failed
did_checks_pass() {
    local pr_url="$1"
    
    local status
    status=$(get_pr_status "$pr_url")
    
    local checks
    checks=$(echo "$status" | jq -r '.statusCheckRollup // []')
    
    if [[ "$checks" == "[]" ]] || [[ "$checks" == "null" ]]; then
        return 0  # No checks = pass
    fi
    
    # Check for failures
    local failed
    failed=$(echo "$checks" | jq '[.[] | select(.conclusion == "FAILURE" or .conclusion == "ERROR" or .conclusion == "CANCELLED")] | length')
    
    [[ "$failed" -eq 0 ]]
}

# Get human-readable check status summary
get_check_summary() {
    local pr_url="$1"
    
    local status
    status=$(get_pr_status "$pr_url")
    
    echo "$status" | jq -r '
        .statusCheckRollup // [] |
        group_by(.conclusion // .status) |
        map({
            status: (.[0].conclusion // .[0].status),
            count: length
        }) |
        map("\(.status): \(.count)") |
        join(", ")
    '
}

#######################################
# CI polling
#######################################

# Wait for CI checks to complete
# Returns: 0 if passed, 1 if failed, 2 if timeout
wait_for_ci() {
    local pr_url="$1"
    local timeout="${2:-$CI_TIMEOUT}"
    local interval="${3:-$CI_POLL_INTERVAL}"
    
    log_info "Waiting for CI checks on: $pr_url"
    
    local elapsed=0
    
    while [[ $elapsed -lt $timeout ]]; do
        if are_checks_complete "$pr_url"; then
            local summary
            summary=$(get_check_summary "$pr_url")
            log_info "  CI complete: $summary"
            
            if did_checks_pass "$pr_url"; then
                log_success "  All checks passed"
                return 0
            else
                log_error "  Some checks failed"
                return 1
            fi
        fi
        
        log_debug "  Waiting... ($elapsed/${timeout}s)"
        sleep "$interval"
        elapsed=$((elapsed + interval))
    done
    
    log_warn "  CI timeout after ${timeout}s"
    return 2
}

#######################################
# Merge operations
#######################################

# Merge a PR
# Strategy: squash (default), merge, rebase
merge_pr() {
    local pr_url="$1"
    local strategy="${2:-squash}"
    local delete_branch="${3:-true}"
    
    log_info "Merging PR: $pr_url"
    
    local merge_args=("--$strategy")
    if [[ "$delete_branch" == "true" ]]; then
        merge_args+=("--delete-branch")
    fi
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "gh pr merge $pr_url ${merge_args[*]}"
        return 0
    fi
    
    gh pr merge "$pr_url" "${merge_args[@]}" 2>&1 || {
        log_error "Failed to merge PR"
        return 1
    }
    
    log_success "PR merged successfully"
    return 0
}

# Enable auto-merge on a PR (requires branch protection)
enable_auto_merge() {
    local pr_url="$1"
    local strategy="${2:-squash}"
    
    log_info "Enabling auto-merge: $pr_url"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "gh pr merge $pr_url --auto --$strategy"
        return 0
    fi
    
    gh pr merge "$pr_url" --auto "--$strategy" 2>&1 || {
        log_warn "Could not enable auto-merge (branch protection may not support it)"
        return 1
    }
    
    log_success "Auto-merge enabled"
    return 0
}

#######################################
# Full merge workflow
#######################################

# Process a PR: wait for CI, check mergeability, merge
# Returns: 0 if merged, 1 if failed
process_pr_for_merge() {
    local repo="$1"
    local pr_url="$2"
    local no_wait="${3:-false}"
    local strategy="${4:-squash}"
    
    log_info "Processing PR for merge: $pr_url"
    log_to_repo "$repo" "Starting merge process for $pr_url"
    
    # If no_wait, just enable auto-merge
    if [[ "$no_wait" == "true" ]]; then
        if enable_auto_merge "$pr_url" "$strategy"; then
            set_repo_state "$repo" "auto_merge_enabled" "$pr_url"
            log_to_repo "$repo" "Auto-merge enabled"
            return 0
        else
            set_repo_state "$repo" "auto_merge_failed" "$pr_url"
            return 1
        fi
    fi
    
    # Wait for CI
    local ci_result
    ci_result=$(wait_for_ci "$pr_url"; echo $?)
    
    case $ci_result in
        0)
            log_debug "CI passed, checking mergeability..."
            ;;
        1)
            log_error "CI failed for $pr_url"
            set_repo_state "$repo" "ci_failed" "$pr_url"
            log_to_repo "$repo" "CI failed"
            return 1
            ;;
        2)
            log_warn "CI timeout for $pr_url"
            set_repo_state "$repo" "ci_timeout" "$pr_url"
            log_to_repo "$repo" "CI timeout"
            return 1
            ;;
    esac
    
    # Check mergeability
    if ! is_pr_mergeable "$pr_url"; then
        log_error "PR not mergeable (conflicts or blocked)"
        set_repo_state "$repo" "not_mergeable" "$pr_url"
        log_to_repo "$repo" "Not mergeable"
        return 1
    fi
    
    # Merge
    if merge_pr "$pr_url" "$strategy" "true"; then
        set_repo_state "$repo" "merged" "$pr_url"
        log_to_repo "$repo" "Merged successfully"
        return 0
    else
        set_repo_state "$repo" "merge_failed" "$pr_url"
        log_to_repo "$repo" "Merge failed"
        return 1
    fi
}

# Process multiple PRs from state file
process_pending_prs() {
    local state_file="${1:-$STATE_DIR/operations.json}"
    local no_wait="${2:-false}"
    
    if [[ ! -f "$state_file" ]]; then
        log_error "State file not found: $state_file"
        return 1
    fi
    
    log_info "Processing pending PRs from state file..."
    
    local repos_to_process
    mapfile -t repos_to_process < <(jq -r '.repos | to_entries[] | select(.value.status == "pr_created") | .key' "$state_file")
    
    if [[ ${#repos_to_process[@]} -eq 0 ]]; then
        log_info "No pending PRs to process"
        return 0
    fi
    
    log_info "Found ${#repos_to_process[@]} PRs to process"
    
    local success=0
    local failed=0
    
    for repo in "${repos_to_process[@]}"; do
        local pr_url
        pr_url=$(jq -r --arg repo "$repo" '.repos[$repo].pr_url' "$state_file")
        
        if process_pr_for_merge "$repo" "$pr_url" "$no_wait"; then
            ((success++))
        else
            ((failed++))
        fi
    done
    
    log_info "Processed: $success merged, $failed failed"
    
    [[ $failed -eq 0 ]]
}
