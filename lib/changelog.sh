#!/usr/bin/env bash
# changelog.sh — Changelog generation and updates

set -euo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true

#######################################
# Changelog Utilities
#######################################

# Format current date
get_date() {
    date "+%Y-%m-%d"
}

# Get changelog file path (supports multiple naming conventions)
find_changelog() {
    local dir="${1:-.}"
    
    # Check common changelog file names
    for name in CHANGELOG.md CHANGELOG CHANGES.md CHANGES History.md HISTORY.md; do
        if [[ -f "$dir/$name" ]]; then
            echo "$dir/$name"
            return 0
        fi
    done
    
    # Default to CHANGELOG.md
    echo "$dir/CHANGELOG.md"
    return 0
}

# Check if changelog exists
has_changelog() {
    local dir="${1:-.}"
    local changelog
    changelog=$(find_changelog "$dir")
    [[ -f "$changelog" ]]
}

#######################################
# Changelog Entry Creation
#######################################

# Generate changelog entry text
generate_changelog_entry() {
    local version="$1"
    local changes="$2"
    local date
    date=$(get_date)
    
    cat <<EOF

## [$version] - $date

### Security

$changes

EOF
}

# Format package update as changelog line
format_package_update() {
    local package="$1"
    local ecosystem="${2:-npm}"
    
    echo "- Update \`$package\` to fix security vulnerability"
}

# Generate changelog text from package list
generate_security_changelog() {
    local version="$1"
    shift
    local packages=("$@")
    
    local changes=""
    for pkg in "${packages[@]}"; do
        changes+="- Update \`$pkg\` to fix security vulnerability"$'\n'
    done
    
    generate_changelog_entry "$version" "$changes"
}

#######################################
# Keep a Changelog Format
#######################################

# Insert new entry after the header in Keep a Changelog format
# https://keepachangelog.com/
update_keepachangelog() {
    local file="$1"
    local version="$2"
    local entry="$3"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "Add changelog entry for $version to $file"
        return 0
    fi
    
    local tmp_file
    tmp_file=$(mktemp)
    
    # Look for ## [Unreleased] or first ## [version] line
    local inserted=false
    while IFS= read -r line || [[ -n "$line" ]]; do
        echo "$line"
        
        # Insert after header section, before first version entry
        if [[ "$inserted" == "false" ]] && [[ "$line" =~ ^##[[:space:]]*\[ ]]; then
            # Found first version heading, insert before it
            # Actually we need to insert BEFORE this line, so backtrack
            :
        fi
        
        # Insert after ## [Unreleased] section
        if [[ "$inserted" == "false" ]] && [[ "$line" =~ ^##[[:space:]]*\[Unreleased\] ]]; then
            # Read until next ## heading and insert after
            while IFS= read -r subline || [[ -n "$subline" ]]; do
                if [[ "$subline" =~ ^## ]]; then
                    echo "$entry"
                    echo "$subline"
                    inserted=true
                    break
                fi
                echo "$subline"
            done
        fi
    done < "$file" > "$tmp_file"
    
    # If no proper structure found, prepend after first heading
    if [[ "$inserted" == "false" ]]; then
        awk -v entry="$entry" '
            /^#[^#]/ && !done { print; print entry; done=1; next }
            { print }
        ' "$file" > "$tmp_file"
    fi
    
    mv "$tmp_file" "$file"
}

# Simple prepend approach for basic changelogs
prepend_changelog_entry() {
    local file="$1"
    local entry="$2"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "Prepend changelog entry to $file"
        return 0
    fi
    
    local tmp_file
    tmp_file=$(mktemp)
    
    # Read first line (should be # Changelog or similar)
    local first_line
    first_line=$(head -1 "$file")
    
    if [[ "$first_line" =~ ^#[[:space:]] ]]; then
        # Has header, insert after it
        {
            echo "$first_line"
            echo "$entry"
            tail -n +2 "$file"
        } > "$tmp_file"
    else
        # No header, prepend
        {
            echo "$entry"
            cat "$file"
        } > "$tmp_file"
    fi
    
    mv "$tmp_file" "$file"
}

#######################################
# WordPress readme.txt Changelog
#######################################

# Update changelog section in WordPress readme.txt
update_wp_readme_changelog() {
    local dir="$1"
    local version="$2"
    local changes="$3"
    
    local readme="$dir/readme.txt"
    if [[ ! -f "$readme" ]]; then
        return 0
    fi
    
    log_info "Updating changelog in readme.txt"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "Add entry to readme.txt changelog"
        return 0
    fi
    
    local tmp_file
    tmp_file=$(mktemp)
    
    local in_changelog=false
    local entry_added=false
    
    while IFS= read -r line || [[ -n "$line" ]]; do
        echo "$line"
        
        if [[ "$line" == "== Changelog ==" ]]; then
            in_changelog=true
            # Add new entry after heading
            echo ""
            echo "= $version ="
            echo "$changes"
            entry_added=true
        fi
    done < "$readme" > "$tmp_file"
    
    if [[ "$entry_added" == "true" ]]; then
        mv "$tmp_file" "$readme"
    else
        rm -f "$tmp_file"
    fi
}

#######################################
# Main Changelog Function
#######################################

# Update changelog with security fixes
# Usage: update_changelog "/path/to/repo" "1.2.3" "package1" "package2" ...
update_changelog() {
    local dir="$1"
    local version="$2"
    shift 2
    local packages=("$@")
    
    log_info "Updating changelog for version $version"
    
    # Build changes text
    local changes=""
    for pkg in "${packages[@]}"; do
        changes+="- Update \`$pkg\` to fix security vulnerability"$'\n'
    done
    changes="${changes%$'\n'}"  # Remove trailing newline
    
    local changelog_file
    changelog_file=$(find_changelog "$dir")
    
    if [[ -f "$changelog_file" ]]; then
        log_info "Found $(basename "$changelog_file")"
        local entry
        entry=$(generate_changelog_entry "$version" "$changes")
        prepend_changelog_entry "$changelog_file" "$entry"
    else
        log_info "Creating $changelog_file"
        if [[ "$DRY_RUN" != "true" ]]; then
            cat > "$changelog_file" <<EOF
# Changelog

All notable changes to this project will be documented in this file.

$(generate_changelog_entry "$version" "$changes")
EOF
        fi
    fi
    
    # Also update WordPress readme.txt if present
    if [[ -f "$dir/readme.txt" ]]; then
        update_wp_readme_changelog "$dir" "$version" "$changes"
    fi
    
    return 0
}

# Add simple entry without version bump
add_changelog_entry() {
    local dir="$1"
    local category="${2:-Changed}"
    local message="$3"
    
    local changelog_file
    changelog_file=$(find_changelog "$dir")
    
    if [[ ! -f "$changelog_file" ]]; then
        log_warn "No changelog found at $changelog_file"
        return 1
    fi
    
    log_info "Adding entry to $(basename "$changelog_file")"
    
    # For now, just log what would be added
    log_info "  [$category] $message"
    
    return 0
}
