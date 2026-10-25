document.addEventListener('DOMContentLoaded', () => {
    if (window.location.search.includes('trace=')) {
        document.getElementById('welcome-screen').classList.add('hidden');
    }
    
    // Formerly onload
    if (typeof initialize === 'function') {
        initialize();
    }

    // Attach event listeners to replace inline onclick handlers
    const dropdownSelected = document.querySelector('.custom-dropdown-selected');
    if (dropdownSelected) {
        dropdownSelected.addEventListener('click', toggleCustomDropdown);
    }
    
    const optionExecute = document.querySelector('.custom-dropdown-option:nth-child(1)');
    if (optionExecute) {
        optionExecute.addEventListener('click', (event) => selectCustomDropdownOption('execute', 'Auto-execute', event));
    }

    const optionReview = document.querySelector('.custom-dropdown-option:nth-child(2)');
    if (optionReview) {
        optionReview.addEventListener('click', (event) => selectCustomDropdownOption('review', 'Review plans', event));
    }
    
    const closeBtn = document.querySelector('.close-button');
    if (closeBtn) {
        closeBtn.addEventListener('click', hide_maximized_content);
    }
});

function toggleCustomDropdown() {
    document.getElementById('workflow-dropdown-options').classList.toggle('active');
}

function selectCustomDropdownOption(value, text, event) {
    document.getElementById('workflow-mode').value = value;
    document.querySelector('.custom-dropdown-selected').innerText = text;
    
    let options = document.querySelectorAll('.custom-dropdown-option');
    options.forEach(opt => opt.classList.remove('selected'));
    event.currentTarget.classList.add('selected');

    document.getElementById('workflow-dropdown-options').classList.remove('active');
}

// Close dropdown when clicking outside
document.addEventListener('click', function(event) {
    if (!event.target.closest('.custom-dropdown-container')) {
        let dropdown = document.getElementById('workflow-dropdown-options');
        if (dropdown && dropdown.classList.contains('active')) {
            dropdown.classList.remove('active');
        }
    }
});

document.addEventListener('click', function(event) {
    if (event.target.classList.contains('copy-button')) {
        const pre = event.target.previousElementSibling;
        if (pre && pre.classList.contains('zippy-content')) {
            navigator.clipboard.writeText(pre.textContent).then(() => {
                // optional: show copied feedback
            }).catch(err => {
                console.error('Failed to copy text: ', err);
            });
        }
    }
});
