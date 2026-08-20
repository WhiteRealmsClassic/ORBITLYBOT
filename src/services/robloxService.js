const USER_API = "https://users.roblox.com/v1/usernames/users";
const PRESENCE_API = "https://presence.roblox.com/v1/presence/users";

export async function getUserByUsername(username) {
    const response = await fetch(USER_API, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            usernames: [username],
            excludeBannedUsers: false
        })
    });

    if (!response.ok) {
        throw new Error(
            `Roblox user lookup failed: ${response.status}`
        );
    }

    const data = await response.json();

    if (!data.data || data.data.length === 0) {
        return null;
    }

    return data.data[0];
}

export async function getPresence(userId) {
    const response = await fetch(PRESENCE_API, {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            userIds: [userId]
        })
    });

    if (!response.ok) {
        throw new Error(
            `Roblox presence lookup failed: ${response.status}`
        );
    }

    const data = await response.json();

    return data.userPresences?.[0] ?? null;
}

export async function getRobloxStatus(username) {
    const user = await getUserByUsername(username);

    if (!user) {
        return {
            found: false,
            username
        };
    }

    const presence = await getPresence(user.id);

    return {
        found: true,
        user,
        presence
    };
}
