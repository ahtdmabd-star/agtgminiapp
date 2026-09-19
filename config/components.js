export const appRoutes = {
    deposit: "/app/deposit.html",
    withdraw: "/app/withdraw.html",
    dashboard: "/app/dashboard.html"
};

export function renderIndexButtons(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const buttons = [
        { label: "Deposit", url: appRoutes.deposit, class: "btn-action" },
        { label: "Withdraw", url: appRoutes.withdraw, class: "btn-action" },
        { label: "Dashboard", url: appRoutes.dashboard, class: "btn-action" }
    ];

    container.innerHTML = buttons.map(btn => `
        <button onclick="window.location.href='${btn.url}'" class="${btn.class}">
            ${btn.label}
        </button>
    `).join('');
}
