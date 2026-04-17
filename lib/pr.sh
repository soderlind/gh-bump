#!/usr/bin/env bash
# pr.sh — Branch creation + PR creation

set -euo pipefail

# Source utils if not already loaded
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true
# shellcheck source=detect.sh
source "$SCRIPT_DIR/detect.sh" 2>/dev/null || true
# shellcheck source=build.sh
source "$SCRIPT_DIR/build.sh" 2>/dev/null || true
# shellcheck source=version.sh
source "$SCRIPT_DIR/version.sh" 2>/dev/null || true
# shellcheck source=changelog.sh
source "$SCRIPT_DIR/changelog.sh" 2>/dev/null || true

#######################################
# Configuration
#######################################

BRANCH_PREFIX="${BRANCH_PREFIX:-gh-bump}"
DEFAULT_BASE_BRANCH="${DEFAULT_BASE_BRANCH:-main}"

#######################################
# Branch management
#######################################

# Generate branch name
# Format: gh-bump/YYYY-MM-DD or gh-bump/YYYY-MM-DD-N
generate_branch_name() {
    local date_suffix
    date_suffix=$(date +"%Y-%m-%d")
    echo "${BRANCH_PREFIX}/${date_suffix}"
}

# Get default branch for repo
get_default_branch() {
    local repo="$1"
    gh api "repos/$repo" --jq '.default_branch' 2>/dev/null || echo "$DEFAULT_BASE_BRANCH"
}

# Create and checkout branch
create_branch() {
    local dir="${1:-.}"
    local branch_name="${2:-$(generate_branch_name)}"
    
    cd "$dir"
    
    # Ensure we're on default branch and up to date
    local default_branch
    default_branch=$(git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@' || echo "main")
    
    run_cmd git checkout "$default_branch" 2>&1 || true
    run_cmd git pull --ff-only 2>&1 || true
    
    # Create new branch
    run_cmd git checkout -b "$branch_name" 2>&1
    
    echo "$branch_name"
}

#######################################
# Commit changes
#######################################

# Commit all changes with a standard message
commit_changes() {
    local dir="${1:-.}"
    local message="${2:-chore(deps): fix security vulnerabilities}"
    
    cd "$dir"
    
    # Stage all changes
    run_cmd git add -A
    
    # Check if there are changes to commit
    if git diff --cached --quiet 2>/dev/null; then
        log_warn "No changes to commit"
        return 1
    fi
    
    # Commit
    run_cmd git commit -m "$message"
    
    return 0
}

# Push branch to remote
push_branch() {
    local dir="${1:-.}"
    local branch="${2:-}"
    
    cd "$dir"
    
    if [[ -z "$branch" ]]; then
        branch=$(git rev-parse --abbrev-ref HEAD)
    fi
    
    run_cmd git push -u origin "$branch"
    
    return 0
}

#######################################
# PR creation
#######################################

# Generate PR body from alert summary
generate_pr_body() {
    local repo="$1"
    local alert_summary="${2:-}"
    
    local body="## Security Dependency Updates

This PR fixes security vulnerabilities detected by Dependabot.

### Changes
- Updated vulnerable dependencies to secure versions
- Applied \`npm audit fix\`, \`pip-audit\`, or equivalent for detected ecosystems

### Automated by
[gh-bump](https://github.com/soderlind/gh-bump) - Batch Dependabot fix automation

---

"

    if [[ -n "$alert_summary" ]]; then
        body+="### Alert Summary
\`\`\`json
$alert_summary
\`\`\`
"
    fi

    body+="
> ⚠️ **Review carefully** before merging. Some updates may introduce breaking changes.
"

    echo "$body"
}

# Create a pull request
# Returns: PR URL
create_pr() {
    local repo="$1"
    local branch="$2"
    local title="${3:-chore(deps): fix security vulnerabilities}"
    local alert_summary="${4:-}"
    local base_branch="${5:-}"
    local auto_merge="${6:-false}"
    local merge_now="${7:-false}"
    local new_version="${8:-}"
    local create_release="${9:-false}"
    local create_tag="${10:-false}"
    
    # Get default branch if not specified
    if [[ -z "$base_branch" ]]; then
        base_branch=$(get_default_branch "$repo")
    fi
    
    local body
    body=$(generate_pr_body "$repo" "$alert_summary")
    
    log_info "Creating PR: $title"
    log_debug "  Repo: $repo"
    log_debug "  Branch: $branch -> $base_branch"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "gh pr create --repo '$repo' --head '$branch' --base '$base_branch' --title '$title'"
        echo "https://github.com/$repo/pull/dry-run"
        return 0
    fi
    
    local pr_url
    pr_url=$(gh pr create \
        --repo "$repo" \
        --head "$branch" \
        --base "$base_branch" \
        --title "$title" \
        --body "$body" \
        2>&1) || {
        log_error "Failed to create PR: $pr_url"
        return 1
    }
    
    log_success "PR created: $pr_url"
    
    # Track if merge was successful for release/tag creation
    local merge_successful=false
    
    # Merge handling
    if [[ "$merge_now" == "true" ]]; then
        # Immediate merge (no waiting for auto-merge)
        log_info "Merging PR immediately..."
        local merge_output
        merge_output=$(gh pr merge "$pr_url" --squash --delete-branch 2>&1) || {
            log_warn "Could not merge: $merge_output"
        }
        if [[ -z "${merge_output:-}" ]] || [[ "$merge_output" == *"Merged"* ]] || [[ "$merge_output" == *"merged"* ]]; then
            log_success "PR merged successfully"
            merge_successful=true
        fi
        
        # Create release/tag after successful merge
        if [[ "$merge_successful" == "true" ]] && [[ -n "$new_version" ]]; then
            # Strip 'v' prefix if present (we want 1.0.0, not v1.0.0)
            local version_tag="${new_version#v}"
            
            # Create tag if requested
            if [[ "$create_tag" == "true" ]]; then
                log_info "Creating tag: $version_tag"
                if [[ "$DRY_RUN" == "true" ]]; then
                    log_dry_run "gh api repos/$repo/git/refs -f ref=refs/tags/$version_tag -f sha=..."
                else
                    # Get the latest commit SHA from the default branch after merge
                    local default_branch
                    default_branch=$(get_default_branch "$repo")
                    local sha
                    sha=$(gh api "repos/$repo/git/ref/heads/$default_branch" --jq '.object.sha' 2>/dev/null || echo "")
                    
                    if [[ -n "$sha" ]]; then
                        gh api "repos/$repo/git/refs" \
                            -f "ref=refs/tags/$version_tag" \
                            -f "sha=$sha" >/dev/null 2>&1 && \
                            log_success "Tag created: $version_tag" || \
                            log_warn "Could not create tag: $version_tag"
                    else
                        log_warn "Could not get SHA for tag creation"
                    fi
                fi
            fi
            
            # Create release if requested
            if [[ "$create_release" == "true" ]]; then
                log_info "Creating release: $version_tag"
                if [[ "$DRY_RUN" == "true" ]]; then
                    log_dry_run "gh release create $version_tag --repo $repo --title $version_tag --generate-notes"
                else
                    gh release create "$version_tag" \
                        --repo "$repo" \
                        --title "$version_tag" \
                        --generate-notes >/dev/null 2>&1 && \
                        log_success "Release created: $version_tag" || \
                        log_warn "Could not create release: $version_tag"
                fi
            fi
        fi
    elif [[ "$auto_merge" == "true" ]]; then
        # Enable auto-merge (requires repo settings)
        log_info "Enabling auto-merge..."
        local merge_output
        merge_output=$(gh pr merge "$pr_url" --auto --squash 2>&1) || {
            # "clean status" means PR is ready to merge - not an error
            if [[ "$merge_output" == *"clean status"* ]]; then
                log_info "PR is ready to merge (passed checks)"
            else
                log_warn "Could not enable auto-merge: $merge_output"
                log_info "Tip: Use --merge-now for immediate merge, or enable auto-merge in repo settings"
            fi
        }
        
        # Note: release/tag creation requires --merge-now since auto-merge is async
        if [[ "$create_release" == "true" ]] || [[ "$create_tag" == "true" ]]; then
            log_info "Note: --release and --tag require --merge-now to work immediately"
        fi
    fi
    
    echo "$pr_url"
}

#######################################
# Full workflow
#######################################

# Clone repo, apply fixes, create PR
# Returns: PR URL or empty if no changes
process_repo_for_pr() {
    local repo="$1"
    local work_dir="${2:-/tmp/gh-bump}"
    local auto_merge="${3:-false}"
    local alert_summary="${4:-}"
    local bump_version="${5:-false}"
    local skip_build="${6:-false}"
    local run_tests="${7:-false}"
    local update_changelog="${8:-true}"
    local release_type="${9:-patch}"
    local merge_now="${10:-false}"
    local create_release="${11:-false}"
    local create_tag="${12:-false}"
    
    local repo_dir="$work_dir/${repo//\//_}"
    
    log_info "Processing: $repo"
    log_to_repo "$repo" "Starting processing"
    
    # Clone repo
    log_info "  Cloning..."
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "gh repo clone $repo $repo_dir -- --depth=1"
    else
        rm -rf "$repo_dir"
        gh repo clone "$repo" "$repo_dir" -- --depth=1 2>&1 || {
            log_error "  Failed to clone $repo"
            set_repo_state "$repo" "clone_failed"
            return 1
        }
    fi
    
    # Create branch
    local branch_name
    branch_name=$(generate_branch_name)
    log_info "  Creating branch: $branch_name"
    
    if [[ "$DRY_RUN" != "true" ]]; then
        create_branch "$repo_dir" "$branch_name" || {
            log_error "  Failed to create branch"
            set_repo_state "$repo" "branch_failed"
            return 1
        }
    else
        log_dry_run "git checkout -b $branch_name"
    fi
    
    # Apply fixes
    log_info "  Applying fixes..."
    # Source fix.sh for apply_fixes function
    source "$SCRIPT_DIR/fix.sh"
    
    # Extract package names from alert summary for targeted updates
    local packages=""
    if [[ -n "$alert_summary" ]]; then
        packages=$(echo "$alert_summary" | jq -r '.packages // [] | join(",")' 2>/dev/null || echo "")
    fi
    
    if [[ "$DRY_RUN" != "true" ]]; then
        if ! apply_fixes "$repo_dir" "$packages"; then
            log_warn "  No fixes applied or no changes"
        fi
        
        # Check for changes
        if ! has_changes "$repo_dir"; then
            log_info "  No changes after fix attempt"
            set_repo_state "$repo" "no_changes"
            rm -rf "$repo_dir"
            return 0
        fi
        
        # Post-fix workflow
        local project_type new_version
        project_type=$(detect_project_type "$repo_dir")
        log_info "  Detected: $(get_project_type_name "$project_type")"
        
        # Run build if not skipped
        if [[ "$skip_build" != "true" ]]; then
            log_info "  Running build..."
            if ! run_build "$repo_dir"; then
                log_warn "  Build failed, continuing anyway"
            fi
        fi
        
        # Run tests if requested
        if [[ "$run_tests" == "true" ]]; then
            log_info "  Running tests..."
            if ! run_tests "$repo_dir"; then
                log_warn "  Tests failed, continuing anyway"
            fi
        fi
        
        # Extract package names for changelog
        local pkg_array=()
        if [[ -n "$packages" ]]; then
            IFS=',' read -ra pkg_array <<< "$packages"
        fi
        
        # Bump version if requested
        if [[ "$bump_version" == "true" ]]; then
            new_version=$(bump_version "$repo_dir" "$release_type")
            log_info "  New version: $new_version"
        else
            new_version=$(get_project_version "$repo_dir")
        fi
        
        # Update changelog
        if [[ "$update_changelog" == "true" ]] && [[ ${#pkg_array[@]} -gt 0 ]]; then
            local ver="${new_version:-unreleased}"
            update_changelog "$repo_dir" "$ver" "${pkg_array[@]}"
        fi
    else
        log_dry_run "apply_fixes $repo_dir"
        
        # Show what post-fix steps would happen
        if [[ "$skip_build" != "true" ]]; then
            log_dry_run "run_build $repo_dir"
        fi
        if [[ "$run_tests" == "true" ]]; then
            log_dry_run "run_tests $repo_dir"
        fi
        if [[ "$bump_version" == "true" ]]; then
            log_dry_run "bump_version $repo_dir $release_type"
        fi
        if [[ "$update_changelog" == "true" ]]; then
            log_dry_run "update_changelog $repo_dir"
        fi
    fi
    
    # Commit changes
    log_info "  Committing..."
    if [[ "$DRY_RUN" != "true" ]]; then
        commit_changes "$repo_dir" "chore(deps): fix security vulnerabilities

Automated fix by gh-bump.
Addresses Dependabot security alerts." || {
            log_warn "  Nothing to commit"
            set_repo_state "$repo" "no_changes"
            return 0
        }
    else
        log_dry_run "git commit -m 'chore(deps): fix security vulnerabilities'"
    fi
    
    # Push branch
    log_info "  Pushing..."
    if [[ "$DRY_RUN" != "true" ]]; then
        push_branch "$repo_dir" "$branch_name" || {
            log_error "  Failed to push"
            set_repo_state "$repo" "push_failed"
            return 1
        }
    else
        log_dry_run "git push -u origin $branch_name"
    fi
    
    # Create PR
    log_info "  Creating PR..."
    local pr_url
    pr_url=$(create_pr "$repo" "$branch_name" \
        "chore(deps): fix security vulnerabilities" \
        "$alert_summary" \
        "" \
        "$auto_merge" \
        "$merge_now" \
        "${new_version:-}" \
        "$create_release" \
        "$create_tag") || {
        log_error "  Failed to create PR"
        set_repo_state "$repo" "pr_failed"
        return 1
    }
    
    # Extract PR number for rollback
    local pr_number
    pr_number=$(echo "$pr_url" | grep -oE '[0-9]+$' || echo "")
    
    # Update state
    local sha=""
    if [[ "$DRY_RUN" != "true" ]]; then
        sha=$(cd "$repo_dir" && git rev-parse HEAD)
    fi
    set_repo_state "$repo" "pr_created" "$pr_url" "$sha"
    add_rollback_command "$repo" "$pr_number"
    
    log_to_repo "$repo" "PR created: $pr_url"
    
    # Cleanup
    if [[ "$DRY_RUN" != "true" ]]; then
        rm -rf "$repo_dir"
    fi
    
    log_success "  Done: $pr_url"
    echo "$pr_url"
}
