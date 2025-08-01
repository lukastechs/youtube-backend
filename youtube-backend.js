// index.js
const express = require('express');
const dotenv = require('dotenv');
const fetch = require('node-fetch');

dotenv.config();

const app = express();
const port = process.env.PORT || 8080;
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY;

// In-memory cache
const cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000;

// Enable CORS for socialagechecker.com
app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', 'https://socialagechecker.com');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    next();
});

// Calculate channel age
function calculateChannelAge(creationDate) {
    const now = new Date();
    const created = new Date(creationDate);
    let years = now.getFullYear() - created.getFullYear();
    let months = now.getMonth() - created.getMonth();
    let days = now.getDate() - created.getDate();

    if (days < 0) {
        months -= 1;
        const prevMonth = new Date(now.getFullYear(), now.getMonth(), 0);
        days += prevMonth.getDate();
    }

    if (months < 0) {
        years -= 1;
        months += 12;
    }

    const totalDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));

    return {
        accountAge: `${years} years, ${months} months, ${days} days`,
        age_days: totalDays
    };
}

// Extract channel ID from URL, handle, or ID
async function extractChannelId(input) {
    if (!input) return null;
    input = input.trim();

    // Direct channel ID
    if (/^UC[0-9a-zA-Z_-]{22}$/.test(input)) {
        return input;
    }
    // Channel URL (e.g., https://www.youtube.com/channel/UC...)
    const channelMatch = input.match(/youtube\.com\/channel\/(UC[0-9a-zA-Z_-]{22})/i);
    if (channelMatch) {
        return channelMatch[1];
    }
    // Handle or custom URL (e.g., @MrBeast, https://www.youtube.com/@MrBeast)
    const handleMatch = input.match(/(?:youtube\.com\/)?@?([^\s\/]+)/i);
    if (handleMatch) {
        const handle = handleMatch[1].replace(/^@/, '');
        try {
            const response = await fetch(
                `https://www.googleapis.com/youtube/v3/channels?part=id&forHandle=${encodeURIComponent(handle)}&key=${YOUTUBE_API_KEY}`,
                { headers: { 'User-Agent': 'SocialAgeChecker/1.0' } }
            );
            const data = await response.json();
            if (data.items && data.items.length > 0) {
                return data.items[0].id;
            }
        } catch (error) {
            console.error(`Error resolving handle ${handle}:`, error.message);
        }
    }
    return null;
}

// Root endpoint for health checks
app.get('/', (req, res) => {
    res.status(200).json({
        status: 'OK',
        message: 'YouTube Age Checker Backend is running',
        endpoints: [
            '/api/youtube-age',
            '/health'
        ]
    });
});

// Channel age endpoint (POST for frontend compatibility)
app.post('/api/youtube-age', async (req, res) => {
    const channelInput = req.body.channel;
    if (!channelInput) {
        console.error(`Invalid channel input: ${channelInput}`);
        return res.status(400).json({ error: 'Channel URL or ID is required' });
    }

    const channelId = await extractChannelId(channelInput);
    if (!channelId) {
        console.error(`Invalid channel input: ${channelInput}`);
        return res.status(400).json({ error: 'Invalid channel URL or ID' });
    }

    const cacheKey = channelId;
    const cached = cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
        console.log(`Cache hit for channel ID: ${channelId}`);
        return res.json({ ...cached.data, is_cached: true });
    }

    try {
        const response = await fetch(
            `https://www.googleapis.com/youtube/v3/channels?part=snippet,statistics&id=${channelId}&key=${YOUTUBE_API_KEY}`,
            { headers: { 'User-Agent': 'SocialAgeChecker/1.0' } }
        );
        if (!response.ok) {
            console.error(`API error for channel ID ${channelId}: HTTP ${response.status}`);
            return res.status(response.status).json({ error: 'Failed to fetch channel data' });
        }

        const data = await response.json();
        if (!data.items || data.items.length === 0) {
            console.error(`No channel found for ID: ${channelId}`);
            return res.status(404).json({ error: 'Channel not found' });
        }

        const channel = data.items[0];
        const creationDate = channel.snippet.publishedAt;
        const { accountAge, age_days } = calculateChannelAge(creationDate);
        const subscriberCount = parseInt(channel.statistics.subscriberCount || 0);
        const verificationStatus = subscriberCount >= 100000 ? 'Verified' : 'Not Verified';

        const responseData = {
            channel_id: channel.id,
            channel_name: channel.snippet.title || 'N/A',
            profile_image_url: channel.snippet.thumbnails?.default?.url || 'https://via.placeholder.com/50',
            creation_date: creationDate,
            account_age: accountAge,
            age_days,
            country: channel.snippet.country || 'N/A',
            verification_status: verificationStatus,
            accuracy: 'Exact',
            subscribers: subscriberCount
        };

        cache.set(cacheKey, { data: responseData, timestamp: Date.now() });
        console.log(`Successfully fetched data for channel ID: ${channelId}`);
        res.json({ ...responseData, is_cached: false });
    } catch (error) {
        console.error(`Error fetching channel for ID ${channelId}:`, error.message);
        res.status(500).json({ error: 'Could not fetch channel data' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ status: 'OK' });
});

app.listen(port, () => {
    console.log(`Server running on port ${port}`);
});
