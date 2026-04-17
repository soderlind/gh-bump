#!/usr/bin/env bash
# fix.sh — Ecosystem detection + dependency fix commands

set -euo pipefail

# Source utils if not already loaded
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=utils.sh
source "$SCRIPT_DIR/utils.sh" 2>/dev/null || true

#######################################
# Ecosystem detection
#######################################

# Detect package ecosystem(s) in a directory
# Returns: npm|yarn|pip|bundler|cargo|composer|go|maven|gradle|unknown
detect_ecosystem() {
    local dir="${1:-.}"
    local ecosystems=()
    
    # JavaScript/Node
    if [[ -f "$dir/package-lock.json" ]]; then
        ecosystems+=("npm")
    elif [[ -f "$dir/yarn.lock" ]]; then
        ecosystems+=("yarn")
    elif [[ -f "$dir/pnpm-lock.yaml" ]]; then
        ecosystems+=("pnpm")
    elif [[ -f "$dir/package.json" ]]; then
        ecosystems+=("npm")  # Default to npm
    fi
    
    # Python
    if [[ -f "$dir/requirements.txt" ]] || [[ -f "$dir/Pipfile.lock" ]] || [[ -f "$dir/poetry.lock" ]]; then
        ecosystems+=("pip")
    fi
    
    # Ruby
    if [[ -f "$dir/Gemfile.lock" ]]; then
        ecosystems+=("bundler")
    fi
    
    # Rust
    if [[ -f "$dir/Cargo.lock" ]]; then
        ecosystems+=("cargo")
    fi
    
    # PHP
    if [[ -f "$dir/composer.lock" ]]; then
        ecosystems+=("composer")
    fi
    
    # Go
    if [[ -f "$dir/go.sum" ]]; then
        ecosystems+=("go")
    fi
    
    # Java
    if [[ -f "$dir/pom.xml" ]]; then
        ecosystems+=("maven")
    elif [[ -f "$dir/build.gradle" ]] || [[ -f "$dir/build.gradle.kts" ]]; then
        ecosystems+=("gradle")
    fi
    
    # .NET
    if compgen -G "$dir/*.csproj" > /dev/null || compgen -G "$dir/*.fsproj" > /dev/null; then
        ecosystems+=("nuget")
    fi
    
    if [[ ${#ecosystems[@]} -eq 0 ]]; then
        echo "unknown"
    else
        printf '%s\n' "${ecosystems[@]}"
    fi
}

#######################################
# Fix commands per ecosystem
#######################################

# Apply security fixes for npm
# Optional second arg: comma-separated list of packages to update
fix_npm() {
    local dir="${1:-.}"
    local packages="${2:-}"
    
    cd "$dir"
    
    # If specific packages provided (from Dependabot), update those first
    if [[ -n "$packages" ]]; then
        log_info "Updating specific packages from Dependabot: $packages"
        local pkg_array
        IFS=',' read -ra pkg_array <<< "$packages"
        for pkg in "${pkg_array[@]}"; do
            pkg=$(echo "$pkg" | xargs)  # trim whitespace
            log_info "  Updating: $pkg"
            run_cmd npm update "$pkg" 2>&1 || true
        done
    fi
    
    # Then try npm audit fix
    log_info "Running npm audit fix..."
    if npm audit --json 2>/dev/null | jq -e '.vulnerabilities | length > 0' > /dev/null; then
        run_cmd npm audit fix --force 2>&1 || {
            log_warn "npm audit fix --force had issues, trying without --force"
            run_cmd npm audit fix 2>&1 || true
        }
    else
        # npm audit found nothing, but Dependabot might have
        # Try a general update of nested dependencies
        if [[ -z "$packages" ]]; then
            log_info "No npm audit vulnerabilities, trying npm update..."
            run_cmd npm update 2>&1 || true
        fi
    fi
    
    return 0
}

# Apply security fixes for yarn
fix_yarn() {
    local dir="${1:-.}"
    
    log_info "Running yarn upgrade (audit fix not available in Yarn v1)..."
    
    cd "$dir"
    
    # Yarn v1 doesn't have audit fix, need to use upgrade
    # For Yarn v2+, use yarn up
    if [[ -f ".yarnrc.yml" ]]; then
        # Yarn 2+/Berry
        run_cmd yarn up 2>&1 || true
    else
        # Yarn 1.x - upgrade vulnerable packages
        run_cmd yarn upgrade 2>&1 || true
    fi
    
    return 0
}

# Apply security fixes for pnpm
fix_pnpm() {
    local dir="${1:-.}"
    
    log_info "Running pnpm audit fix..."
    
    cd "$dir"
    run_cmd pnpm audit --fix 2>&1 || true
    
    return 0
}

# Apply security fixes for pip/Python
fix_pip() {
    local dir="${1:-.}"
    
    log_info "Running pip-audit fix..."
    
    cd "$dir"
    
    # Check if pip-audit is available
    if ! command -v pip-audit &> /dev/null; then
        log_warn "pip-audit not installed, attempting pip install pip-audit"
        pip install pip-audit 2>/dev/null || {
            log_error "Could not install pip-audit"
            return 1
        }
    fi
    
    run_cmd pip-audit --fix -r requirements.txt 2>&1 || true
    
    return 0
}

# Apply security fixes for bundler/Ruby
fix_bundler() {
    local dir="${1:-.}"
    
    log_info "Running bundle update for vulnerable gems..."
    
    cd "$dir"
    
    # Get vulnerable gems from bundle audit
    if command -v bundle-audit &> /dev/null; then
        local vulnerable_gems
        vulnerable_gems=$(bundle-audit check --update 2>/dev/null | grep -oP 'Gem: \K\S+' || true)
        
        if [[ -n "$vulnerable_gems" ]]; then
            for gem in $vulnerable_gems; do
                run_cmd bundle update "$gem" 2>&1 || true
            done
        fi
    else
        # Fallback: just update all
        run_cmd bundle update 2>&1 || true
    fi
    
    return 0
}

# Apply security fixes for cargo/Rust
fix_cargo() {
    local dir="${1:-.}"
    
    log_info "Running cargo update..."
    
    cd "$dir"
    run_cmd cargo update 2>&1 || true
    
    return 0
}

# Apply security fixes for composer/PHP
fix_composer() {
    local dir="${1:-.}"
    
    log_info "Running composer update..."
    
    cd "$dir"
    run_cmd composer update --no-interaction 2>&1 || true
    
    return 0
}

# Apply security fixes for go modules
fix_go() {
    local dir="${1:-.}"
    
    log_info "Running go get -u for vulnerable packages..."
    
    cd "$dir"
    run_cmd go get -u ./... 2>&1 || true
    run_cmd go mod tidy 2>&1 || true
    
    return 0
}

# Apply security fixes for Maven
fix_maven() {
    local dir="${1:-.}"
    
    log_info "Maven requires manual version updates in pom.xml"
    log_warn "Attempting versions:use-latest-releases..."
    
    cd "$dir"
    run_cmd mvn versions:use-latest-releases -DgenerateBackupPoms=false 2>&1 || true
    
    return 0
}

# Apply security fixes for Gradle
fix_gradle() {
    local dir="${1:-.}"
    
    log_info "Gradle requires manual version updates"
    log_warn "Attempting to refresh dependencies..."
    
    cd "$dir"
    run_cmd ./gradlew dependencies --refresh-dependencies 2>&1 || true
    
    return 0
}

# Apply security fixes for NuGet/.NET
fix_nuget() {
    local dir="${1:-.}"
    
    log_info "Running dotnet outdated and update..."
    
    cd "$dir"
    
    # List outdated packages
    if command -v dotnet-outdated &> /dev/null; then
        run_cmd dotnet-outdated --upgrade 2>&1 || true
    else
        # Manual update
        run_cmd dotnet restore 2>&1 || true
    fi
    
    return 0
}

#######################################
# Main fix dispatcher
#######################################

# Apply fixes for all detected ecosystems
# Args: dir [packages]
# packages: comma-separated list from Dependabot alerts
# Returns 0 if any changes made, 1 if no changes
apply_fixes() {
    local dir="${1:-.}"
    local packages="${2:-}"
    local changes_made=false
    
    log_info "Detecting ecosystems in $dir..."
    
    local ecosystems
    mapfile -t ecosystems < <(detect_ecosystem "$dir")
    
    if [[ "${ecosystems[0]}" == "unknown" ]]; then
        log_warn "No recognized package ecosystem found"
        return 1
    fi
    
    log_info "Found ecosystems: ${ecosystems[*]}"
    
    for ecosystem in "${ecosystems[@]}"; do
        log_info "Applying fixes for: $ecosystem"
        
        case "$ecosystem" in
            npm)     fix_npm "$dir" "$packages" && changes_made=true ;;
            yarn)    fix_yarn "$dir" && changes_made=true ;;
            pnpm)    fix_pnpm "$dir" && changes_made=true ;;
            pip)     fix_pip "$dir" && changes_made=true ;;
            bundler) fix_bundler "$dir" && changes_made=true ;;
            cargo)   fix_cargo "$dir" && changes_made=true ;;
            composer) fix_composer "$dir" && changes_made=true ;;
            go)      fix_go "$dir" && changes_made=true ;;
            maven)   fix_maven "$dir" && changes_made=true ;;
            gradle)  fix_gradle "$dir" && changes_made=true ;;
            nuget)   fix_nuget "$dir" && changes_made=true ;;
            *)       log_warn "Unknown ecosystem: $ecosystem" ;;
        esac
    done
    
    if [[ "$changes_made" == "true" ]]; then
        return 0
    else
        return 1
    fi
}

# Check if there are uncommitted changes
has_changes() {
    local dir="${1:-.}"
    cd "$dir"
    ! git diff --quiet 2>/dev/null || ! git diff --cached --quiet 2>/dev/null
}
