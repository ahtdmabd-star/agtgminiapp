export const appRoutes = {
    dashboard: "/app/index.html",
    deposit: "/app/deposit.html",
    withdraw: "/app/withdraw.html",
    tasks: "/app/tasks.html",
    history: "/app/history.html"
};

export function renderDashboardButtons(containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;

    const buttons = [
        { label: "Deposit", url: appRoutes.deposit, class: "btn-action btn-deposit" },
        { label: "Withdraw", url: appRoutes.withdraw, class: "btn-action btn-withdraw" },
        { label: "Micro Tasks", url: appRoutes.tasks, class: "btn-action btn-tasks" },
        { label: "Transaction History", url: appRoutes.history, class: "btn-action btn-history" }
    ];

    container.innerHTML = buttons.map(btn => `
        <button onclick="window.location.href='${btn.url}'" class="${btn.class}">
            ${btn.label}
        </button>
    `).join('');
}
