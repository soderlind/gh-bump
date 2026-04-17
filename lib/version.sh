#!/usr/bin/env bash
# version.sh — Version parsing and bumping

set -euo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true
# shellcheck source=detect.sh
source "$SCRIPT_DIR/detect.sh" 2>/dev/null || true

#######################################
# Version Utilities
#######################################

# Increment a semver version
# Usage: increment_version "1.2.3" "patch" -> "1.2.4"
increment_version() {
    local version="$1"
    local bump_type="${2:-patch}"
    
    # Strip 'v' prefix if present
    version="${version#v}"
    
    # Parse version parts (handle 2 or 3 part versions)
    IFS='.' read -ra parts <<< "$version"
    local major="${parts[0]:-0}"
    local minor="${parts[1]:-0}"
    local patch="${parts[2]:-0}"
    
    case "$bump_type" in
        major)
            echo "$((major + 1)).0.0"
            ;;
        minor)
            echo "${major}.$((minor + 1)).0"
            ;;
        patch|*)
            echo "${major}.${minor}.$((patch + 1))"
            ;;
    esac
}

#######################################
# WordPress Version Bumping
#######################################

# Bump version in WordPress plugin file
bump_wp_plugin_version() {
    local dir="${1:-.}"
    local new_version="$2"
    
    local plugin_file
    plugin_file=$(find_wp_plugin_file "$dir")
    
    if [[ -z "$plugin_file" ]]; then
        log_error "No WordPress plugin file found"
        return 1
    fi
    
    log_info "Updating version in $(basename "$plugin_file") to $new_version"
    
    # Update plugin header (macOS-compatible sed with -E for extended regex)
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "sed -i 's/Version:.*/Version: $new_version/' $plugin_file"
    else
        sed -i.bak -E "s/^( \* Version:[[:space:]]*)[0-9.]+/\1$new_version/" "$plugin_file"
        sed -i.bak -E "s/^(Version:[[:space:]]*)[0-9.]+/\1$new_version/" "$plugin_file"
        rm -f "${plugin_file}.bak"
    fi
    
    # Update readme.txt if exists
    if [[ -f "$dir/readme.txt" ]]; then
        log_info "Updating Stable tag in readme.txt"
        if [[ "$DRY_RUN" != "true" ]]; then
            sed -i.bak -E "s/^(Stable tag:[[:space:]]*)[0-9.]+/\1$new_version/" "$dir/readme.txt"
            rm -f "$dir/readme.txt.bak"
        fi
    fi
    
    # Update constant if defined (e.g., PLUGIN_VERSION)
    if grep -qE "define.*VERSION.*[0-9]+\.[0-9]+" "$plugin_file" 2>/dev/null; then
        log_info "Updating version constant"
        if [[ "$DRY_RUN" != "true" ]]; then
            sed -i.bak -E "s/(define.*VERSION.*')[0-9.]+(')/\1$new_version\2/" "$plugin_file"
            rm -f "${plugin_file}.bak"
        fi
    fi
    
    return 0
}

# Bump version in WordPress theme
bump_wp_theme_version() {
    local dir="${1:-.}"
    local new_version="$2"
    
    if [[ ! -f "$dir/style.css" ]]; then
        log_error "No style.css found"
        return 1
    fi
    
    log_info "Updating version in style.css to $new_version"
    
    if [[ "$DRY_RUN" != "true" ]]; then
        sed -i.bak -E "s/^(Version:[[:space:]]*)[0-9.]+/\1$new_version/" "$dir/style.css"
        rm -f "$dir/style.css.bak"
    fi
    
    return 0
}

#######################################
# npm Version Bumping
#######################################

# Bump version in package.json
bump_npm_version() {
    local dir="${1:-.}"
    local new_version="$2"
    
    log_info "Updating version in package.json to $new_version"
    
    cd "$dir"
    
    if [[ "$DRY_RUN" == "true" ]]; then
        log_dry_run "npm version $new_version --no-git-tag-version"
    else
        # Use npm version for proper JSON handling
        npm version "$new_version" --no-git-tag-version --allow-same-version 2>&1 || {
            # Fallback to jq if npm version fails
            local tmp_file
            tmp_file=$(mktemp)
            jq --arg v "$new_version" '.version = $v' package.json > "$tmp_file" && mv "$tmp_file" package.json
        }
    fi
    
    return 0
}

#######################################
# Python Version Bumping
#######################################

# Bump version in pyproject.toml or setup.py
bump_python_version() {
    local dir="${1:-.}"
    local new_version="$2"
    
    if [[ -f "$dir/pyproject.toml" ]]; then
        log_info "Updating version in pyproject.toml to $new_version"
        if [[ "$DRY_RUN" != "true" ]]; then
            sed -i.bak -E "s/^(version[[:space:]]*=[[:space:]]*\")[^\"]+\"/\1$new_version\"/" "$dir/pyproject.toml"
            rm -f "$dir/pyproject.toml.bak"
        fi
    elif [[ -f "$dir/setup.py" ]]; then
        log_info "Updating version in setup.py to $new_version"
        if [[ "$DRY_RUN" != "true" ]]; then
            sed -i.bak -E "s/(version[[:space:]]*=[[:space:]]*['\"][^'\"]*)[0-9.]+/\1$new_version/" "$dir/setup.py"
            rm -f "$dir/setup.py.bak"
        fi
    fi
    
    return 0
}

#######################################
# Composer Version Bumping
#######################################

bump_composer_version() {
    local dir="${1:-.}"
    local new_version="$2"
    
    if [[ ! -f "$dir/composer.json" ]]; then
        return 1
    fi
    
    log_info "Updating version in composer.json to $new_version"
    
    if [[ "$DRY_RUN" != "true" ]]; then
        local tmp_file
        tmp_file=$(mktemp)
        jq --arg v "$new_version" '.version = $v' "$dir/composer.json" > "$tmp_file" && mv "$tmp_file" "$dir/composer.json"
    fi
    
    return 0
}

#######################################
# Main Version Bump Function
#######################################

# Bump version for detected project type
# Usage: bump_version "/path/to/repo" "patch|minor|major"
bump_version() {
    local dir="${1:-.}"
    local bump_type="${2:-patch}"
    
    local type current_version new_version
    type=$(detect_project_type "$dir")
    current_version=$(get_project_version "$dir")
    
    if [[ -z "$current_version" ]]; then
        log_warn "Could not determine current version, using 0.0.0"
        current_version="0.0.0"
    fi
    
    new_version=$(increment_version "$current_version" "$bump_type")
    
    log_info "Bumping version: $current_version -> $new_version ($bump_type)"
    
    case "$type" in
        "$PROJECT_TYPE_WORDPRESS_PLUGIN"|"$PROJECT_TYPE_WORDPRESS_BLOCK")
            bump_wp_plugin_version "$dir" "$new_version"
            # Also update package.json if present
            [[ -f "$dir/package.json" ]] && bump_npm_version "$dir" "$new_version"
            ;;
            
        "$PROJECT_TYPE_WORDPRESS_THEME")
            bump_wp_theme_version "$dir" "$new_version"
            [[ -f "$dir/package.json" ]] && bump_npm_version "$dir" "$new_version"
            ;;
            
        "$PROJECT_TYPE_NPM_PACKAGE"|"$PROJECT_TYPE_NEXTJS_APP")
            bump_npm_version "$dir" "$new_version"
            ;;
            
        "$PROJECT_TYPE_PYTHON_PACKAGE")
            bump_python_version "$dir" "$new_version"
            ;;
            
        "$PROJECT_TYPE_COMPOSER_PACKAGE")
            bump_composer_version "$dir" "$new_version"
            ;;
            
        "$PROJECT_TYPE_GO_MODULE")
            log_info "Go modules use git tags for versioning"
            log_info "After merge, create tag: git tag v$new_version"
            ;;
            
        *)
            log_warn "No version bump strategy for $(get_project_type_name "$type")"
            return 1
            ;;
    esac
    
    echo "$new_version"
    return 0
}
