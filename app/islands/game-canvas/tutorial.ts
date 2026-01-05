/**
 * Tutorial system for Antigravity Project 1
 */

export function startTutorial() {
    console.log("Starting tutorial...");

    // Create arrow element
    const arrow = document.createElement('div');
    arrow.id = 'tutorial-arrow';
    arrow.style.cssText = `
        position: fixed;
        width: 0;
        height: 0;
        border-left: 15px solid transparent;
        border-right: 15px solid transparent;
        border-top: 30px solid #FFD54F;
        z-index: 10000;
        display: none;
        pointer-events: none;
        filter: drop-shadow(0 4px 4px rgba(0,0,0,0.5));
    `;
    document.body.appendChild(arrow);

    // Create dialog element
    const dialog = document.createElement('div');
    dialog.id = 'tutorial-dialog';
    dialog.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(0, 0, 0, 0.9);
        color: white;
        padding: 24px;
        border-radius: 16px;
        width: 80%;
        max-width: 400px;
        font-family: system-ui, sans-serif;
        z-index: 10000;
        border: 2px solid #FFD54F;
        box-shadow: 0 0 20px rgba(0,0,0,0.8);
        text-align: center;
    `;
    document.body.appendChild(dialog);

    let step = 0;

    const steps = [
        {
            text: "Welcome! To move your character use the joystick.",
            position: () => {
                const joystick = document.getElementById('joystick-container');
                if (joystick) {
                    const rect = joystick.getBoundingClientRect();
                    arrow.style.display = 'block';
                    arrow.style.left = `${rect.left + rect.width / 2 - 15}px`;
                    arrow.style.top = `${rect.top - 40}px`;
                    // Add bounce animation
                    arrow.style.animation = 'tutorial-bounce 1s infinite';
                    if (!document.getElementById('tutorial-style')) {
                        const style = document.createElement('style');
                        style.id = 'tutorial-style';
                        style.innerHTML = `
                            @keyframes tutorial-bounce {
                                0%, 100% { transform: translateY(0); }
                                50% { transform: translateY(-10px); }
                            }
                        `;
                        document.head.appendChild(style);
                    }
                }
            }
        },
        {
            text: "Swipe left and right to rotate your view.",
            position: () => {
                arrow.style.display = 'none';
            }
        },
        {
            text: "Use the buttons at the top to access your inventory, character customization, camera views, and hiscores.",
            position: () => {
                const scoresBtn = document.getElementById('scores-btn');
                if (scoresBtn) {
                    const rect = scoresBtn.parentElement!.getBoundingClientRect();
                    arrow.style.display = 'block';
                    arrow.style.left = `${rect.left + rect.width / 2 - 15}px`;
                    arrow.style.top = `${rect.top + rect.height + 10}px`;
                    arrow.style.borderTop = 'none';
                    arrow.style.borderBottom = '30px solid #FFD54F';

                    // Specific animation for pointed up arrow
                    arrow.style.animation = 'tutorial-bounce-up 1s infinite';
                    if (!document.getElementById('tutorial-style-up')) {
                        const style = document.createElement('style');
                        style.id = 'tutorial-style-up';
                        style.innerHTML = `
                            @keyframes tutorial-bounce-up {
                                0%, 100% { transform: translateY(0); }
                                50% { transform: translateY(10px); }
                            }
                        `;
                        document.head.appendChild(style);
                    }
                }
            }
        }
    ];

    function showStep() {
        if (step >= steps.length) {
            completeTutorial();
            return;
        }

        const currentStep = steps[step];
        dialog.innerHTML = `
            <div style="font-size: 18px; margin-bottom: 24px; line-height: 1.5;">${currentStep.text}</div>
            <button id="tutorial-ok-btn" style="background: #FFD54F; color: black; border: none; padding: 10px 30px; border-radius: 8px; font-weight: bold; cursor: pointer; font-size: 16px; text-transform: uppercase;">Ok</button>
        `;

        currentStep.position();

        document.getElementById('tutorial-ok-btn')?.addEventListener('click', () => {
            step++;
            showStep();
        });
    }

    async function completeTutorial() {
        arrow.remove();
        dialog.remove();

        try {
            await fetch('/api/user-tutorial', { method: 'POST' });
        } catch (err) {
            console.error('Failed to save tutorial progress:', err);
        }
    }

    showStep();
}
