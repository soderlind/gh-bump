#!/usr/bin/env bash
# discover.sh — Repo enumeration + Dependabot alert fetching

set -euo pipefail

# Source utils if not already loaded
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true

#######################################
# Configuration
#######################################

RATE_LIMIT_DELAY="${RATE_LIMIT_DELAY:-1}"  # Seconds between API calls
CACHE_TTL="${CACHE_TTL:-3600}"              # Cache validity in seconds (1 hour)

#######################################
# Repo enumeration
#######################################

# List all repos for current user
list_user_repos() {
    log_debug "Fetching user repos..."
    local result
    result=$(GH_PAGER=cat gh repo list --limit 500 --json nameWithOwner 2>/dev/null) || return 0
    if [[ -n "$result" ]] && [[ "$result" != "null" ]] && [[ "$result" != "[]" ]]; then
        echo "$result" | jq -r '.[].nameWithOwner' 2>/dev/null || true
    fi
}

# List all repos for an organization
list_org_repos() {
    local org="$1"
    log_debug "Fetching repos for org: $org"
    local result
    result=$(GH_PAGER=cat gh repo list "$org" --limit 500 --json nameWithOwner 2>/dev/null) || return 0
    if [[ -n "$result" ]] && [[ "$result" != "null" ]] && [[ "$result" != "[]" ]]; then
        echo "$result" | jq -r '.[].nameWithOwner' 2>/dev/null || true
    fi
}

# List all orgs user belongs to
list_user_orgs() {
    log_debug "Fetching user organizations..."
    local result
    result=$(GH_PAGER=cat gh api user/orgs 2>/dev/null) || return 0
    if [[ -n "$result" ]] && [[ "$result" != "null" ]] && [[ "$result" != "[]" ]]; then
        echo "$result" | jq -r '.[].login' 2>/dev/null || true
    fi
}

# Get all repos (user + all orgs)
get_all_repos() {
    local pattern="${1:-}"
    local org_filter="${2:-}"
    local repos=()
    
    if [[ -n "$org_filter" ]]; then
        # Only specified org
        log_info "Fetching repos from org: $org_filter"
        while IFS= read -r repo; do
            [[ -n "$repo" ]] && repos+=("$repo")
        done < <(list_org_repos "$org_filter")
    else
        # User repos
        log_info "Fetching user repos..."
        while IFS= read -r repo; do
            [[ -n "$repo" ]] && repos+=("$repo")
        done < <(list_user_repos)
        
        # All org repos
        log_info "Fetching organization repos..."
        while IFS= read -r org; do
            if [[ -n "$org" ]]; then
                log_debug "  Org: $org"
                while IFS= read -r repo; do
                    [[ -n "$repo" ]] && repos+=("$repo")
                done < <(list_org_repos "$org")
            fi
        done < <(list_user_orgs)
    fi
    
    # Filter by pattern if provided
    local filtered=()
    for repo in "${repos[@]}"; do
        if repo_matches_pattern "$repo" "$pattern"; then
            filtered+=("$repo")
        fi
    done
    
    log_info "Found ${#filtered[@]} repos matching pattern '${pattern:-*}'"
    
    printf '%s\n' "${filtered[@]}"
}

#######################################
# Dependabot alerts
#######################################

# Get Dependabot alerts for a repo
# Returns JSON array of alerts
get_repo_alerts() {
    local repo="$1"
    local severity_filter="${2:-}"
    local state="${3:-open}"
    
    log_debug "Fetching alerts for: $repo"
    
    local query="state=$state"
    if [[ -n "$severity_filter" ]]; then
        query="$query&severity=$severity_filter"
    fi
    
    local result
    result=$(gh api "repos/$repo/dependabot/alerts?$query" --paginate 2>/dev/null) || {
        # Might not have access or Dependabot not enabled
        log_debug "  Could not fetch alerts for $repo (no access or Dependabot disabled)"
        echo "[]"
        return
    }
    
    echo "$result"
}

# Check if repo has any open alerts
repo_has_alerts() {
    local repo="$1"
    local severity_filter="${2:-}"
    
    local alerts
    alerts=$(get_repo_alerts "$repo" "$severity_filter" "open")
    
    local count
    count=$(echo "$alerts" | jq 'if type == "array" then length else 0 end')
    
    [[ "$count" -gt 0 ]]
}

# Get alert summary for a repo
# Returns: {repo, alert_count, severities[], packages[]}
get_alert_summary() {
    local repo="$1"
    local severity_filter="${2:-}"
    
    local alerts
    alerts=$(get_repo_alerts "$repo" "$severity_filter" "open")
    
    echo "$alerts" | jq --arg repo "$repo" '{
        repo: $repo,
        alert_count: (if type == "array" then length else 0 end),
        severities: (if type == "array" then [.[].security_advisory.severity] | unique else [] end),
        packages: (if type == "array" then [.[].security_vulnerability.package.name] | unique else [] end),
        ecosystems: (if type == "array" then [.[].security_vulnerability.package.ecosystem] | unique else [] end)
    }'
}

#######################################
# Discovery workflow
#######################################

# Main discovery function
# Outputs repos.json manifest
discover_repos_with_alerts() {
    local pattern="${1:-}"
    local org="${2:-}"
    local severity="${3:-}"
    local cache_file="$STATE_DIR/repos.json"
    
    # Check cache validity
    if [[ -f "$cache_file" ]]; then
        local cache_age
        cache_age=$(( $(date +%s) - $(stat -f %m "$cache_file" 2>/dev/null || stat -c %Y "$cache_file" 2>/dev/null || echo 0) ))
        
        if [[ $cache_age -lt $CACHE_TTL ]]; then
            log_info "Using cached repo list (age: ${cache_age}s)"
            cat "$cache_file"
            return
        fi
    fi
    
    log_info "Discovering repos with Dependabot alerts..."
    
    local repos_with_alerts=()
    local total_alerts=0
    local checked=0
    
    # Get all matching repos
    local all_repos
    mapfile -t all_repos < <(get_all_repos "$pattern" "$org")
    local total=${#all_repos[@]}
    
    log_info "Checking $total repos for Dependabot alerts..."
    
    for repo in "${all_repos[@]}"; do
        ((checked++))
        
        # Rate limiting
        if [[ $((checked % 10)) -eq 0 ]]; then
            log_debug "Progress: $checked/$total"
            sleep "$RATE_LIMIT_DELAY"
        fi
        
        # Get alert summary
        local summary
        summary=$(get_alert_summary "$repo" "$severity")
        
        local count
        count=$(echo "$summary" | jq '.alert_count')
        
        if [[ "$count" -gt 0 ]]; then
            repos_with_alerts+=("$summary")
            total_alerts=$((total_alerts + count))
            log_info "  ${GREEN}✓${NC} $repo: $count alert(s)"
        else
            log_debug "  $repo: no alerts"
        fi
    done
    
    # Build manifest
    local repos_json="[]"
    if [[ ${#repos_with_alerts[@]} -gt 0 ]]; then
        repos_json=$(printf '%s\n' "${repos_with_alerts[@]}" | jq -s '.')
    fi
    
    local manifest
    manifest=$(jq -n \
        --arg ts "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" \
        --arg pattern "$pattern" \
        --arg severity "$severity" \
        --argjson repos "$repos_json" \
        '{
            generated_at: $ts,
            filter: {pattern: $pattern, severity: $severity},
            total_repos: ($repos | length),
            total_alerts: ([$repos[].alert_count] | add // 0),
            repos: $repos
        }')
    
    # Save to cache
    if [[ "$DRY_RUN" != "true" ]]; then
        echo "$manifest" > "$cache_file"
    fi
    
    log_success "Found ${#repos_with_alerts[@]} repos with $total_alerts total alerts"
    
    echo "$manifest"
}

# Get list of repos from manifest
get_repos_from_manifest() {
    local manifest_file="${1:-$STATE_DIR/repos.json}"
    
    if [[ ! -f "$manifest_file" ]]; then
        log_error "Manifest not found: $manifest_file"
        return 1
    fi
    
    jq -r '.repos[].repo' "$manifest_file"
}

# Invalidate cache
invalidate_cache() {
    local cache_file="$STATE_DIR/repos.json"
    if [[ -f "$cache_file" ]]; then
        rm "$cache_file"
        log_info "Cache invalidated"
    fi
}
