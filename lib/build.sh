#!/usr/bin/env bash
# build.sh — Run build commands per project type

set -euo pipefail

# Source dependencies
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true
# shellcheck source=detect.sh
source "$SCRIPT_DIR/detect.sh" 2>/dev/null || true

#######################################
# Build Commands
#######################################

# Run npm install if needed
run_npm_install() {
    local dir="${1:-.}"
    cd "$dir"
    
    if [[ ! -d "node_modules" ]] || [[ "package.json" -nt "node_modules" ]]; then
        log_info "Running npm install..."
        run_cmd npm install 2>&1 || {
            log_warn "npm install failed"
            return 1
        }
    fi
    return 0
}

# Run npm build
run_npm_build() {
    local dir="${1:-.}"
    cd "$dir"
    
    if has_npm_build "$dir"; then
        log_info "Running npm run build..."
        run_cmd npm run build 2>&1 || {
            log_warn "npm run build failed"
            return 1
        }
    else
        log_debug "No build script found in package.json"
    fi
    return 0
}

# Run composer install
run_composer_install() {
    local dir="${1:-.}"
    cd "$dir"
    
    if [[ -f "composer.json" ]]; then
        log_info "Running composer install..."
        run_cmd composer install --no-interaction 2>&1 || {
            log_warn "composer install failed"
            return 1
        }
    fi
    return 0
}

# Run Python package install
run_python_install() {
    local dir="${1:-.}"
    cd "$dir"
    
    local manager
    manager=$(detect_python_manager "$dir")
    
    case "$manager" in
        poetry)
            log_info "Running poetry install..."
            run_cmd poetry install 2>&1 || return 1
            ;;
        pipenv)
            log_info "Running pipenv install..."
            run_cmd pipenv install 2>&1 || return 1
            ;;
        pip)
            if [[ -f "requirements.txt" ]]; then
                log_info "Running pip install..."
                run_cmd pip install -r requirements.txt 2>&1 || return 1
            fi
            ;;
    esac
    return 0
}

# Run Go build
run_go_build() {
    local dir="${1:-.}"
    cd "$dir"
    
    log_info "Running go build..."
    run_cmd go build ./... 2>&1 || {
        log_warn "go build failed"
        return 1
    }
    return 0
}

#######################################
# Main Build Function
#######################################

# Run build for detected project type
# Returns: 0 on success, 1 on failure
run_build() {
    local dir="${1:-.}"
    local type
    type=$(detect_project_type "$dir")
    
    log_info "Building project ($(get_project_type_name "$type"))..."
    
    case "$type" in
        "$PROJECT_TYPE_WORDPRESS_BLOCK")
            # WordPress blocks need npm install + build
            run_npm_install "$dir" || return 1
            run_npm_build "$dir" || return 1
            # Also composer if present
            [[ -f "$dir/composer.json" ]] && run_composer_install "$dir"
            ;;
            
        "$PROJECT_TYPE_WORDPRESS_PLUGIN"|"$PROJECT_TYPE_WORDPRESS_THEME")
            # WordPress plugins may have npm and/or composer
            if [[ -f "$dir/package.json" ]]; then
                run_npm_install "$dir" || true
                run_npm_build "$dir" || true
            fi
            [[ -f "$dir/composer.json" ]] && run_composer_install "$dir"
            ;;
            
        "$PROJECT_TYPE_NPM_PACKAGE"|"$PROJECT_TYPE_NEXTJS_APP")
            run_npm_install "$dir" || return 1
            run_npm_build "$dir" || return 1
            ;;
            
        "$PROJECT_TYPE_PYTHON_PACKAGE")
            run_python_install "$dir" || return 1
            ;;
            
        "$PROJECT_TYPE_COMPOSER_PACKAGE")
            run_composer_install "$dir" || return 1
            ;;
            
        "$PROJECT_TYPE_GO_MODULE")
            run_go_build "$dir" || return 1
            ;;
            
        *)
            log_debug "No build step for generic project"
            ;;
    esac
    
    return 0
}

#######################################
# Test Commands
#######################################

# Run tests for detected project type
run_tests() {
    local dir="${1:-.}"
    local type
    type=$(detect_project_type "$dir")
    
    log_info "Running tests..."
    cd "$dir"
    
    case "$type" in
        "$PROJECT_TYPE_WORDPRESS_BLOCK"|"$PROJECT_TYPE_WORDPRESS_PLUGIN"|"$PROJECT_TYPE_WORDPRESS_THEME"|"$PROJECT_TYPE_NPM_PACKAGE"|"$PROJECT_TYPE_NEXTJS_APP")
            if has_npm_test "$dir"; then
                run_cmd npm test 2>&1 || {
                    log_warn "Tests failed"
                    return 1
                }
            else
                log_debug "No test script found"
            fi
            ;;
            
        "$PROJECT_TYPE_PYTHON_PACKAGE")
            if [[ -f "$dir/pytest.ini" ]] || [[ -d "$dir/tests" ]]; then
                run_cmd pytest 2>&1 || return 1
            fi
            ;;
            
        "$PROJECT_TYPE_GO_MODULE")
            run_cmd go test ./... 2>&1 || return 1
            ;;
            
        "$PROJECT_TYPE_COMPOSER_PACKAGE")
            if jq -e '.scripts.test' "$dir/composer.json" >/dev/null 2>&1; then
                run_cmd composer test 2>&1 || return 1
            fi
            ;;
    esac
    
    return 0
}
