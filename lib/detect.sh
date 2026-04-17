#!/usr/bin/env bash
# detect.sh — Project type detection

set -euo pipefail

# Source utils if not already loaded
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true

#######################################
# Project Types
#######################################

PROJECT_TYPE_WORDPRESS_PLUGIN="wordpress_plugin"
PROJECT_TYPE_WORDPRESS_THEME="wordpress_theme"
PROJECT_TYPE_WORDPRESS_BLOCK="wordpress_block"
PROJECT_TYPE_NPM_PACKAGE="npm_package"
PROJECT_TYPE_NEXTJS_APP="nextjs_app"
PROJECT_TYPE_PYTHON_PACKAGE="python_package"
PROJECT_TYPE_COMPOSER_PACKAGE="composer_package"
PROJECT_TYPE_GO_MODULE="go_module"
PROJECT_TYPE_GENERIC="generic"

#######################################
# WordPress Detection
#######################################

# Find WordPress plugin main file (PHP file with Plugin Name header)
find_wp_plugin_file() {
    local dir="${1:-.}"
    
    # Check root PHP files for Plugin Name header
    for php_file in "$dir"/*.php; do
        [[ -f "$php_file" ]] || continue
        if grep -q "Plugin Name:" "$php_file" 2>/dev/null; then
            echo "$php_file"
            return 0
        fi
    done
    return 1
}

# Check if directory is a WordPress plugin
is_wordpress_plugin() {
    local dir="${1:-.}"
    find_wp_plugin_file "$dir" >/dev/null 2>&1
}

# Check if directory is a WordPress theme
is_wordpress_theme() {
    local dir="${1:-.}"
    [[ -f "$dir/style.css" ]] && grep -q "Theme Name:" "$dir/style.css" 2>/dev/null
}

# Check if directory is a WordPress block plugin (uses @wordpress/scripts)
is_wordpress_block() {
    local dir="${1:-.}"
    is_wordpress_plugin "$dir" && \
    [[ -f "$dir/package.json" ]] && \
    jq -e '.devDependencies["@wordpress/scripts"] // .dependencies["@wordpress/scripts"]' "$dir/package.json" >/dev/null 2>&1
}

#######################################
# npm/Node Detection
#######################################

# Check if directory is an npm package (not WordPress)
is_npm_package() {
    local dir="${1:-.}"
    [[ -f "$dir/package.json" ]] && \
    ! is_wordpress_plugin "$dir" && \
    ! is_wordpress_theme "$dir"
}

# Check if directory is a Next.js app
is_nextjs_app() {
    local dir="${1:-.}"
    [[ -f "$dir/next.config.js" ]] || [[ -f "$dir/next.config.mjs" ]] || [[ -f "$dir/next.config.ts" ]]
}

# Check if npm package has a build script
has_npm_build() {
    local dir="${1:-.}"
    [[ -f "$dir/package.json" ]] && \
    jq -e '.scripts.build' "$dir/package.json" >/dev/null 2>&1
}

# Check if npm package has a test script
has_npm_test() {
    local dir="${1:-.}"
    [[ -f "$dir/package.json" ]] && \
    jq -e '.scripts.test' "$dir/package.json" >/dev/null 2>&1
}

#######################################
# Python Detection
#######################################

is_python_package() {
    local dir="${1:-.}"
    [[ -f "$dir/pyproject.toml" ]] || [[ -f "$dir/setup.py" ]] || [[ -f "$dir/setup.cfg" ]]
}

detect_python_manager() {
    local dir="${1:-.}"
    if [[ -f "$dir/poetry.lock" ]]; then
        echo "poetry"
    elif [[ -f "$dir/Pipfile.lock" ]]; then
        echo "pipenv"
    else
        echo "pip"
    fi
}

#######################################
# Composer Detection
#######################################

is_composer_package() {
    local dir="${1:-.}"
    [[ -f "$dir/composer.json" ]] && \
    ! is_wordpress_plugin "$dir" && \
    ! is_wordpress_theme "$dir"
}

#######################################
# Go Detection
#######################################

is_go_module() {
    local dir="${1:-.}"
    [[ -f "$dir/go.mod" ]]
}

#######################################
# Main Detection Function
#######################################

# Detect project type
detect_project_type() {
    local dir="${1:-.}"
    
    # Check in order of specificity
    if is_wordpress_block "$dir"; then
        echo "$PROJECT_TYPE_WORDPRESS_BLOCK"
    elif is_wordpress_plugin "$dir"; then
        echo "$PROJECT_TYPE_WORDPRESS_PLUGIN"
    elif is_wordpress_theme "$dir"; then
        echo "$PROJECT_TYPE_WORDPRESS_THEME"
    elif is_nextjs_app "$dir"; then
        echo "$PROJECT_TYPE_NEXTJS_APP"
    elif is_npm_package "$dir"; then
        echo "$PROJECT_TYPE_NPM_PACKAGE"
    elif is_python_package "$dir"; then
        echo "$PROJECT_TYPE_PYTHON_PACKAGE"
    elif is_composer_package "$dir"; then
        echo "$PROJECT_TYPE_COMPOSER_PACKAGE"
    elif is_go_module "$dir"; then
        echo "$PROJECT_TYPE_GO_MODULE"
    else
        echo "$PROJECT_TYPE_GENERIC"
    fi
}

# Get human-readable project type name
get_project_type_name() {
    local type="$1"
    
    case "$type" in
        "$PROJECT_TYPE_WORDPRESS_PLUGIN") echo "WordPress Plugin" ;;
        "$PROJECT_TYPE_WORDPRESS_THEME")  echo "WordPress Theme" ;;
        "$PROJECT_TYPE_WORDPRESS_BLOCK")  echo "WordPress Block Plugin" ;;
        "$PROJECT_TYPE_NPM_PACKAGE")      echo "npm Package" ;;
        "$PROJECT_TYPE_NEXTJS_APP")       echo "Next.js App" ;;
        "$PROJECT_TYPE_PYTHON_PACKAGE")   echo "Python Package" ;;
        "$PROJECT_TYPE_COMPOSER_PACKAGE") echo "Composer Package" ;;
        "$PROJECT_TYPE_GO_MODULE")        echo "Go Module" ;;
        *)                                echo "Generic Project" ;;
    esac
}

#######################################
# Version Extraction
#######################################

# Get current version from project
get_project_version() {
    local dir="${1:-.}"
    local type
    type=$(detect_project_type "$dir")
    
    case "$type" in
        "$PROJECT_TYPE_WORDPRESS_PLUGIN"|"$PROJECT_TYPE_WORDPRESS_BLOCK")
            local plugin_file
            plugin_file=$(find_wp_plugin_file "$dir")
            # macOS-compatible: use sed instead of grep -P
            sed -n 's/.*Version:[[:space:]]*\([0-9.]*\).*/\1/p' "$plugin_file" 2>/dev/null | head -1
            ;;
        "$PROJECT_TYPE_WORDPRESS_THEME")
            sed -n 's/.*Version:[[:space:]]*\([0-9.]*\).*/\1/p' "$dir/style.css" 2>/dev/null | head -1
            ;;
        "$PROJECT_TYPE_NPM_PACKAGE"|"$PROJECT_TYPE_NEXTJS_APP")
            jq -r '.version // ""' "$dir/package.json" 2>/dev/null
            ;;
        "$PROJECT_TYPE_PYTHON_PACKAGE")
            if [[ -f "$dir/pyproject.toml" ]]; then
                sed -n 's/^version[[:space:]]*=[[:space:]]*"\([^"]*\)".*/\1/p' "$dir/pyproject.toml" 2>/dev/null | head -1
            fi
            ;;
        "$PROJECT_TYPE_COMPOSER_PACKAGE")
            jq -r '.version // ""' "$dir/composer.json" 2>/dev/null
            ;;
        "$PROJECT_TYPE_GO_MODULE")
            git -C "$dir" describe --tags --abbrev=0 2>/dev/null || echo ""
            ;;
        *)
            echo ""
            ;;
    esac
}

# Get project name
get_project_name() {
    local dir="${1:-.}"
    local type
    type=$(detect_project_type "$dir")
    
    case "$type" in
        "$PROJECT_TYPE_WORDPRESS_PLUGIN"|"$PROJECT_TYPE_WORDPRESS_BLOCK")
            local plugin_file
            plugin_file=$(find_wp_plugin_file "$dir")
            grep -oP "Plugin Name:\s*\K.+" "$plugin_file" 2>/dev/null | head -1
            ;;
        "$PROJECT_TYPE_WORDPRESS_THEME")
            grep -oP "Theme Name:\s*\K.+" "$dir/style.css" 2>/dev/null | head -1
            ;;
        "$PROJECT_TYPE_NPM_PACKAGE"|"$PROJECT_TYPE_NEXTJS_APP")
            jq -r '.name // ""' "$dir/package.json" 2>/dev/null
            ;;
        *)
            basename "$dir"
            ;;
    esac
}
