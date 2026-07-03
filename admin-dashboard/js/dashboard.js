const PASSWORD_KEY = 'mm_cupid_dashboard_password';
const API_BASE = '/api';
const state = {
    password: '',
    users: [],
    reports: [],
    bannedUsers: []
};

const overlay = document.getElementById('login-overlay');
const passwordInput = document.getElementById('dashboard-password');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');
const searchInput = document.getElementById('search-input');
const usersCount = document.getElementById('users-count');
const matchesCount = document.getElementById('matches-count');
const reportsCount = document.getElementById('reports-count');
const serverStatus = document.getElementById('server-status');
const reportsBody = document.getElementById('reports-table-body');
const usersBody = document.getElementById('users-table-body');
const bannedBody = document.getElementById('banned-table-body');
const userManagementCount = document.getElementById('user-management-count');
const refreshButton = document.getElementById('refresh-data');
const feed = document.getElementById('live-feed');
const sidebarMenu = document.getElementById('sidebar-menu');
const sidebarTabs = document.querySelectorAll('.dashboard-tab');
const overviewSection = document.getElementById('overview-section');
const reportsSection = document.getElementById('reports-section');
const usersSection = document.getElementById('users-section');
const bannedSection = document.getElementById('banned-section');
const reportsPagination = document.getElementById('reports-pagination');
const usersPagination = document.getElementById('users-pagination');
const bannedPagination = document.getElementById('banned-pagination');
const analyticsInsights = document.getElementById('analytics-insights');

function getPassword() {
    return localStorage.getItem(PASSWORD_KEY) || '';
}

function savePassword(password) {
    localStorage.setItem(PASSWORD_KEY, password);
}

function clearPassword() {
    localStorage.removeItem(PASSWORD_KEY);
}

function showLogin(message) {
    if (message) {
        loginError.textContent = message;
        loginError.classList.remove('hidden');
    }
    overlay.classList.remove('hidden');
}

function hideLogin() {
    loginError.classList.add('hidden');
    overlay.classList.add('hidden');
    passwordInput.value = '';
}

async function apiRequest(path, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    const password = getPassword();
    if (password) headers['X-Password'] = password;

    const tryPaths = [`${API_BASE}/${path}`, `/${path}`, `${window.location.origin}${API_BASE}/${path}`, `${window.location.origin}/${path}`];
    let lastErr = null;

    for (const p of tryPaths) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => {
                controller.abort();
            }, 8000);
            const response = await fetch(p, {
                method: options.method || 'GET',
                headers,
                body: options.body ? JSON.stringify(options.body) : undefined,
                signal: controller.signal
            }).finally(() => clearTimeout(timeoutId));
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                let errorBody = null;
                try { errorBody = JSON.parse(text); } catch (parseErr) { }
                if (response.status === 401) {
                    throw new Error('Unauthorized');
                }
                throw new Error(errorBody?.error || errorBody?.message || response.statusText || text || 'Request failed');
            }
            // Parse JSON with timeout and fallback to text to avoid hangs
            let parsed = null;
            try {
                const jsonPromise = response.json();
                const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('JSON parse timeout')), 5000));
                parsed = await Promise.race([jsonPromise, timeoutPromise]);
                return parsed;
            } catch (parseErr) {
                const textBody = await response.text().catch(() => '');
                try {
                    parsed = JSON.parse(textBody);
                    return parsed;
                } catch (recoverErr) {
                    throw new Error(`Invalid JSON response from ${p}: ${recoverErr.message}`);
                }
            }
        } catch (err) {
            lastErr = err;
            if (err.message && err.message.includes('404')) continue;
        }
    }
    throw lastErr || new Error('Request failed');
}

async function verifyPassword(password) {
    // Try both /api/check-auth and /check-auth to support various deployment paths
    const paths = [`${API_BASE}/check-auth`, `/check-auth`, `/api/check-auth`];
    for (const p of paths) {
        try {
            const response = await fetch(p, { method: 'GET', headers: { 'X-Password': password } });
            if (response.ok) return true;
            if (response.status === 404) continue;
        } catch (err) {
            // continue to next path
            continue;
        }
    }
    return false;
}

async function login() {
    const password = passwordInput.value.trim();
    if (!password) {
        showLogin('Please enter the dashboard password.');
        return;
    }
    try {
        const valid = await verifyPassword(password);
        if (!valid) {
            showLogin('Invalid password.');
            return;
        }
        savePassword(password);
        hideLogin();
        await loadDashboard();
    } catch (err) {
        showLogin(err.message || 'Login failed.');
    }
}

function formatDate(value) {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return date.toLocaleString();
}

function createBadge(text, variant) {
    return `<span class="px-3 py-1 rounded-full ${variant === 'ban' ? 'bg-error-container text-on-error-container' : variant === 'shadowban' ? 'bg-surface-container-highest text-on-surface-variant' : 'bg-surface-container-highest text-on-surface-variant'} text-[11px] font-bold">${text}</span>`;
}

function renderStats(data) {
    usersCount.textContent = data.totalUsers || 0;
    matchesCount.textContent = data.totalMatches || 0;
    reportsCount.textContent = data.openReports != null ? data.openReports : state.reports.filter(r => r.status === 'pending').length;
    serverStatus.textContent = data.serverStatus || 'Healthy';

    const activeUsersEl = document.getElementById('active-users');
    if (activeUsersEl) {
        activeUsersEl.textContent = data.activeUsers != null ? data.activeUsers : data.totalUsers || 0;
    }
    const matchesTodayEl = document.getElementById('matches-today');
    if (matchesTodayEl) {
        matchesTodayEl.textContent = data.todayMatches || 0;
    }
    const openReportsEl = document.getElementById('open-reports-card');
    if (openReportsEl) {
        openReportsEl.textContent = data.openReports != null ? data.openReports : (state.reports.filter(r => r.status === 'pending').length || 0);
    }
    const serverStatusEl = document.getElementById('server-status-card');
    if (serverStatusEl) {
        serverStatusEl.textContent = data.serverStatus || 'Healthy';
    }
}

function renderPagination(container, currentPage, totalPages, onPageClick) {
    if (!container) return;
    if (totalPages <= 1) {
        container.innerHTML = '';
        return;
    }
    const pageButtons = [];
    for (let page = 1; page <= totalPages; page++) {
        pageButtons.push(`<button class="px-3 py-2 rounded-full ${page === currentPage ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface'}" data-page="${page}">${page}</button>`);
    }
    container.innerHTML = `<div class="flex flex-wrap gap-2 items-center"><span class="text-label-sm text-on-surface-variant">Page:</span>${pageButtons.join('')}</div>`;
    container.querySelectorAll('button[data-page]').forEach(btn => {
        btn.addEventListener('click', () => onPageClick(Number(btn.dataset.page)));
    });
}

function renderReports(reports, page = 1, pageSize = 10) {
    state.reports = reports || [];
    if (!state.reports.length) {
        reportsBody.innerHTML = '<tr class="hover:bg-surface-container-high/20 transition-colors"><td class="px-6 py-5 text-label-sm text-on-surface-variant" colspan="5">No reports found.</td></tr>';
        renderPagination(reportsPagination, 1, 1, () => {});
        return;
    }

    const totalPages = Math.ceil(state.reports.length / pageSize);
    const startIndex = (page - 1) * pageSize;
    const pagedReports = state.reports.slice(startIndex, startIndex + pageSize);

    reportsBody.innerHTML = pagedReports.map(report => {
        const statusLabel = report.status ? report.status.toUpperCase() : 'PENDING';
        return `<tr class="hover:bg-surface-container-high/20 transition-colors">
            <td class="px-6 py-5 text-label-sm text-on-surface">${report.reporter_name || report.reporter_id || 'Unknown'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${report.reported_name || report.reported_user_id || 'Unknown'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${report.reason || '-'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${statusLabel}</td>
            <td class="px-6 py-5 text-right space-x-2">
                <button class="px-4 py-2 rounded-lg bg-surface-container-highest text-on-surface hover:bg-primary-container hover:text-on-primary-container transition-colors text-label-sm font-bold" onclick="reviewReport(${report.id}, 'resolved')">Resolve</button>
                <button class="px-4 py-2 rounded-lg bg-surface-container-highest text-on-surface hover:bg-primary-container hover:text-on-primary-container transition-colors text-label-sm font-bold" onclick="reviewReport(${report.id}, 'rejected')">Reject</button>
                <button class="px-4 py-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors text-label-sm font-bold" onclick="reviewReport(${report.id}, 'banned')">Ban</button>
            </td>
        </tr>`;
    }).join('');

    renderPagination(reportsPagination, page, totalPages, (newPage) => renderReports(state.reports, newPage, pageSize));
}

function renderUsers(users, totalCount = 0) {
    state.users = users || [];
    if (userManagementCount) {
        const visible = state.users.length;
        const total = totalCount || visible;
        userManagementCount.textContent = `${visible} of ${total} users shown`;
    }
    if (!state.users.length) {
        usersBody.innerHTML = '<tr class="hover:bg-surface-container-high/20 transition-colors"><td class="px-6 py-5 text-label-sm text-on-surface-variant" colspan="7">No users found.</td></tr>';
        renderPagination(usersPagination, 1, 1, () => {});
        return;
    }

    const pagedUsers = state.users;

    usersBody.innerHTML = pagedUsers.map(user => {
        const status = user.is_registered ? 'Active' : 'Pending';
        return `<tr class="hover:bg-surface-container-high/20 transition-colors">
            <td class="px-6 py-5 text-label-sm text-on-surface">${user.username ? `@${user.username}` : '-'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${user.nickname || 'Unknown'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${user.age || '-'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${user.gender || '-'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${user.address || '-'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${status}</td>
            <td class="px-6 py-5 text-right space-x-2">
                <button class="px-4 py-2 rounded-lg bg-surface-container-highest text-on-surface hover:bg-primary-container hover:text-on-primary-container transition-colors text-label-sm font-bold" onclick="banOrUnbanUser(${user.telegram_id}, 'ban')">Ban</button>
                <button class="px-4 py-2 rounded-lg bg-surface-container-highest text-on-surface hover:bg-primary-container hover:text-on-primary-container transition-colors text-label-sm font-bold" onclick="banOrUnbanUser(${user.telegram_id}, 'shadowban')">Shadowban</button>
                <button class="px-4 py-2 rounded-lg bg-error/10 text-error hover:bg-error/20 transition-colors text-label-sm font-bold" onclick="deleteUser(${user.telegram_id})">Delete</button>
            </td>
        </tr>`;
    }).join('');

    renderPagination(usersPagination, 1, 1, () => {});
}

function renderBanned(users, page = 1, pageSize = 10) {
    state.bannedUsers = users || [];
    if (!state.bannedUsers.length) {
        bannedBody.innerHTML = '<tr class="hover:bg-surface-container-high/20 transition-colors"><td class="px-6 py-5 text-label-sm text-on-surface-variant" colspan="5">No banned users found.</td></tr>';
        renderPagination(bannedPagination, 1, 1, () => {});
        return;
    }

    const totalPages = Math.ceil(state.bannedUsers.length / pageSize);
    const startIndex = (page - 1) * pageSize;
    const pagedUsers = state.bannedUsers.slice(startIndex, startIndex + pageSize);

    bannedBody.innerHTML = pagedUsers.map(user => {
        const statusText = user.is_shadowbanned ? 'Shadowbanned' : 'Banned';
        return `<tr class="hover:bg-surface-container-high/20 transition-colors">
            <td class="px-6 py-5 text-label-sm text-on-surface">${user.nickname || 'Unknown'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${statusText}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${user.ban_reason || '-'}</td>
            <td class="px-6 py-5 text-label-sm text-on-surface">${formatDate(user.banned_at)}</td>
            <td class="px-6 py-2 text-right space-x-2">
                <button class="px-4 py-2 rounded-lg bg-surface-container-highest text-on-surface hover:bg-primary-container hover:text-on-primary-container transition-colors text-label-sm font-bold" onclick="banOrUnbanUser(${user.telegram_id}, 'unban')">Unban</button>
                <button class="px-4 py-2 rounded-lg bg-surface-container-highest text-on-surface hover:bg-primary-container hover:text-on-primary-container transition-colors text-label-sm font-bold" onclick="banOrUnbanUser(${user.telegram_id}, 'unshadowban')">Unshadow</button>
            </td>
        </tr>`;
    }).join('');

    renderPagination(bannedPagination, page, totalPages, (newPage) => renderBanned(state.bannedUsers, newPage, pageSize));
}

function formatRelativeTime(value) {
    if (!value) return 'Unknown time';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    const diffMs = Date.now() - date.getTime();
    const diffMinutes = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMinutes / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffMinutes < 1) return 'Just now';
    if (diffMinutes < 60) return `${diffMinutes}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function renderLiveFeed(items) {
    if (!feed) return;
    if (!items || !items.length) {
        feed.innerHTML = `<div class="p-5 rounded-2xl bg-surface-container-low/40 border border-outline-variant text-label-sm text-on-surface-variant">No recent activity yet. New app events will appear here as they happen.</div>`;
        return;
    }
    feed.innerHTML = items.map(item => {
        return `<div class="flex items-center gap-4 p-3 rounded-xl bg-surface-container-low/40 border border-transparent hover:border-primary-container transition-all fade-in">
            <div class="w-10 h-10 rounded-full ${item.iconBg} flex items-center justify-center shrink-0">
                <span class="material-symbols-outlined ${item.iconColor}">${item.icon}</span>
            </div>
            <div class="flex-1 min-w-0">
                <p class="text-label-lg font-bold text-on-surface truncate">${item.title}</p>
                <p class="text-label-sm text-on-surface-variant">${item.subtitle}</p>
            </div>
            <span class="text-[10px] text-on-surface-variant shrink-0">${formatRelativeTime(item.timestamp)}</span>
        </div>`;
    }).join('');
}

function buildFeedItem(name, action, timestamp) {
    const lower = action.toLowerCase();
    const icon = lower.includes('match') ? 'favorite' : lower.includes('joined') ? 'person_add' : lower.includes('report') ? 'report' : lower.includes('message') ? 'mail' : 'sensors';
    const iconBg = lower.includes('match') ? 'bg-primary-container' : lower.includes('joined') ? 'bg-secondary-container' : lower.includes('report') ? 'bg-error-container' : 'bg-tertiary-container';
    const iconColor = lower.includes('match') ? 'text-on-primary' : lower.includes('joined') ? 'text-on-secondary' : lower.includes('report') ? 'text-on-error-container' : 'text-on-tertiary-container';

    return {
        title: name,
        subtitle: action,
        timestamp,
        icon,
        iconBg,
        iconColor
    };
}

function buildFeedItemsFromApi(feedItems) {
    return (feedItems || []).map(item => {
        const title = item.title || (item.type === 'match' ? 'New match' : item.type === 'view' ? 'Profile viewed' : item.type === 'report' ? 'Report submitted' : item.type === 'message' ? 'Secret message' : 'Activity');
        const subtitle = item.subtitle || (item.type === 'match' ? 'Matched' : item.type === 'view' ? 'Profile viewed' : item.type === 'report' ? 'Report submitted' : item.type === 'message' ? 'Secret message sent' : 'Recent activity');
        const timestamp = item.timestamp ? new Date(item.timestamp) : new Date();
        return buildFeedItem(title, subtitle, timestamp);
    });
}

function initializeLiveFeed() {
    const now = Date.now();
    const sampleFeed = [
        buildFeedItem('Thiri M. & Zay Y.', 'Matched in Yangon', new Date(now - 1000 * 60 * 1)),
        buildFeedItem('Kyaw S. K.', 'New user joined', new Date(now - 1000 * 60 * 2)),
        buildFeedItem('Htet Htet', 'Updated profile bio', new Date(now - 1000 * 60 * 12)),
        buildFeedItem('Nadi W. & Min H.', 'Matched in Mandalay', new Date(now - 1000 * 60 * 5)),
        buildFeedItem('Kyaw Kyaw', 'Matched in Naypyidaw', new Date(now - 1000 * 60 * 7))
    ];
    renderLiveFeed(sampleFeed);
    return sampleFeed;
}

function renderAnalytics(data) {
    if (!analyticsInsights) return;
    const totalMatches = data.totalMatches != null ? data.totalMatches : 0;
    const dailyActiveUsers = data.dailyActiveUsers != null ? data.dailyActiveUsers : 0;
    const matchSuccessRate = data.matchSuccessRate || '0%';
    analyticsInsights.innerHTML = `
        <div class="space-y-4">
            <p class="text-label-sm text-on-surface-variant">Last 30 days performance</p>
            <div class="grid grid-cols-2 gap-3 mt-4 text-left">
                <div class="rounded-2xl bg-surface-container-high p-4">
                    <p class="text-label-sm text-on-surface-variant">Total matches</p>
                    <p class="text-headline-sm font-bold text-on-surface">${totalMatches}</p>
                </div>
                <div class="rounded-2xl bg-surface-container-high p-4">
                    <p class="text-label-sm text-on-surface-variant">Active users today</p>
                    <p class="text-headline-sm font-bold text-on-surface">${dailyActiveUsers}</p>
                </div>
            </div>
            <p class="text-label-sm text-on-surface-variant">Match success rate: ${matchSuccessRate}</p>
        </div>`;
}

let liveFeedItems = [];

async function loadDashboard() {
    try {
        const [statsData, usersData, reportsData, bannedData, feedData, analyticsData] = await Promise.all([
            apiRequest('stats'),
            apiRequest('users'),
            apiRequest('reports'),
            apiRequest('banned-users'),
            apiRequest('feed'),
            apiRequest('analytics')
        ]);

        renderStats(statsData);
        renderUsers(usersData.users || [], usersData.total || 0);
        renderReports(reportsData.reports || []);
        renderBanned(bannedData.bannedUsers || []);
        renderAnalytics(analyticsData || {});

        const newFeedItems = buildFeedItemsFromApi(feedData.feed || []);
        if (newFeedItems.length) {
            liveFeedItems = newFeedItems;
            renderLiveFeed(liveFeedItems);
        } else {
            liveFeedItems = [];
            renderLiveFeed([]);
        }
    } catch (err) {
        if (err.message === 'Unauthorized') {
            clearPassword();
            showLogin('Session expired. Please log in again.');
        } else {
            console.error(err);
            const msg = (err.message && err.message.includes('404'))
                ? 'Admin API not found (404). Ensure DASHBOARD_PASSWORD is set and /api/index.js is deployed.'
                : `Unable to load admin dashboard: ${err.message || 'check console/network for details.'}`;
            console.error(msg);
        }
    }
}

function hideAllSections() {
    overviewSection.classList.add('hidden');
    reportsSection.classList.add('hidden');
    usersSection.classList.add('hidden');
    bannedSection.classList.add('hidden');
}

function setActiveTab(targetId) {
    if (sidebarTabs && sidebarTabs.length) {
        sidebarTabs.forEach(tab => {
            if (tab.dataset.target === targetId) {
                tab.classList.add('bg-secondary-container', 'text-on-secondary-container');
                tab.classList.remove('text-on-surface-variant');
            } else {
                tab.classList.remove('bg-secondary-container', 'text-on-secondary-container');
                tab.classList.add('text-on-surface-variant');
            }
        });
    }

    hideAllSections();
    const section = document.getElementById(targetId);
    if (section) {
        section.classList.remove('hidden');
    }
}

async function reviewReport(reportId, action) {
    try {
        await apiRequest('review-report', {
            method: 'POST',
            body: { reportId, action, actionTaken: action }
        });
        await loadDashboard();
    } catch (err) {
        alert(err.message || 'Unable to review report.');
    }
}

async function banOrUnbanUser(userId, action) {
    try {
        await apiRequest('ban', {
            method: 'POST',
            body: { userId, action, reason: action === 'ban' ? 'Admin ban' : action === 'shadowban' ? 'Shadowban' : 'Admin restore' }
        });
        await loadDashboard();
    } catch (err) {
        alert(err.message || 'Unable to update ban status.');
    }
}

async function deleteUser(userId) {
    if (!confirm('Delete this user permanently?')) return;
    try {
        await apiRequest('delete-user', {
            method: 'POST',
            body: { userId }
        });
        await loadDashboard();
    } catch (err) {
        alert(err.message || 'Unable to delete user.');
    }
}

async function searchUsers(query) {
    if (!query) {
        await loadDashboard();
        return;
    }
    try {
        const result = await apiRequest(`search?q=${encodeURIComponent(query)}&type=nickname`);
        renderUsers(result.users || [], result.total || 0);
    } catch (err) {
        alert(err.message || 'Search failed.');
    }
}

function debounce(fn, wait) {
    let timeout;
    return (...args) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => fn(...args), wait);
    };
}

async function init() {
    const savedPassword = getPassword();
    if (savedPassword) {
        try {
            const valid = await verifyPassword(savedPassword);
            if (valid) {
                hideLogin();
                await loadDashboard();
                return;
            }
        } catch (err) {
            console.warn('Password verify failed:', err);
        }
    }
    showLogin();
}

loginButton.addEventListener('click', login);
searchInput.addEventListener('keyup', debounce(() => searchUsers(searchInput.value.trim()), 300));
refreshButton.addEventListener('click', loadDashboard);

function bindSidebarTabs() {
    if (!sidebarTabs || !sidebarTabs.length) return;
    sidebarTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetId = tab.dataset.target;
            if (targetId) {
                setActiveTab(targetId);
            }
        });
    });
}

sidebarMenu?.addEventListener('click', event => {
    const tab = event.target.closest('.dashboard-tab');
    if (!tab) return;
    const targetId = tab.dataset.target;
    if (targetId) {
        setActiveTab(targetId);
    }
});

window.addEventListener('DOMContentLoaded', async () => {
    bindSidebarTabs();
    await init();
    setActiveTab('overview-section');
});

// Micro-interactions for the Dashboard
const buttons = document.querySelectorAll('button');
buttons.forEach(btn => {
    btn.addEventListener('mousedown', () => {
        btn.style.transform = 'scale(0.95)';
    });
    btn.addEventListener('mouseup', () => {
        btn.style.transform = 'scale(1)';
    });
    btn.addEventListener('mouseleave', () => {
        btn.style.transform = 'scale(1)';
    });
});

// The live feed is loaded from the backend. No simulated mock updates are appended here.
