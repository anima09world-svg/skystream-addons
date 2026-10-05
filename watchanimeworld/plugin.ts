(function() {
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    };

    const SELECTORS = {
        SEARCH_ITEM: "article.post, article.item",
        SEARCH_TITLE: ".entry-title",
        SEARCH_LINK: "a.lnk-blk, a[rel='bookmark']",
        EPISODE_ITEM: "article.episodes",
        EPISODE_LINK: "a.lnk-blk",
        EPISODE_NUMBER: ".num-epi",
        EPISODE_TITLE: ".entry-title"
    };

    // Assuming manifest, LoadDoc, MultimediaItem, EpisodeItem are globally injected by SkyStream
    declare const manifest: any;
    declare const LoadDoc: any;
    declare class MultimediaItem { constructor(data: any); }
    declare class EpisodeItem { constructor(data: any); }

    function extractEpisodeInfo(url: string, title: string) {
        let season = 1;
        let episode = 1;
        const urlMatch = url.match(/(\d+)x(\d+)[^/]*$/i);
        if (urlMatch) {
            return { season: parseInt(urlMatch[1], 10), episode: parseInt(urlMatch[2], 10) };
        }
        const titleMatch = title.match(/(\d+)x(\d+)/i);
        if (titleMatch) {
            return { season: parseInt(titleMatch[1], 10), episode: parseInt(titleMatch[2], 10) };
        }
        return { season, episode };
    }

    async function getHome(cb: any) {
        const homeUrl = `${manifest.baseUrl}/`;
        try {
            const req = await fetch(homeUrl, { headers: HEADERS });
            const html = await req.text();
            const $ = LoadDoc(html);
            
            const results: any[] = [];
            const items = $(SELECTORS.SEARCH_ITEM);
            items.each((_i: any, s: any) => {
                const titleEl = s.find(SELECTORS.SEARCH_TITLE);
                let title = titleEl.text().trim();
                title = title.replace(/\s*(?:\(\d{4}\)|Season|BluRay|HD|Multi Audio|Dual Audio|Hindi|Tamil|Telugu|\[).*$/i, '').replace(/[\(\)-]+$/, '').trim();
                const url = s.find(SELECTORS.SEARCH_LINK).attr("href");
                if (!title || !url || url.includes('/episode/')) return;
                
                let posterUrl = s.find('img').attr('src');
                
                results.push(new MultimediaItem({
                    title: title,
                    url: url,
                    type: 'tv',
                    posterUrl: posterUrl
                }));
            });
            cb({ success: true, data: { "Latest Updates": results } });
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    async function search(query: string, cb: any) {
        const searchUrl = `${manifest.baseUrl}/?s=${encodeURIComponent(query)}`;
        try {
            const req = await fetch(searchUrl, { headers: HEADERS });
            const html = await req.text();
            const $ = LoadDoc(html);
            
            const results: any[] = [];
            const items = $(SELECTORS.SEARCH_ITEM);
            
            items.each((_i: any, s: any) => {
                const titleEl = s.find(SELECTORS.SEARCH_TITLE);
                let title = titleEl.text().trim();
                title = title.replace(/\s*(?:\(\d{4}\)|Season|BluRay|HD|Multi Audio|Dual Audio|Hindi|Tamil|Telugu|\[).*$/i, '').replace(/[\(\)-]+$/, '').trim();
                const url = s.find(SELECTORS.SEARCH_LINK).attr("href");
                if (!title || !url || url.includes('/episode/')) return;
                
                let posterUrl = s.find('img').attr('src');
                
                results.push(new MultimediaItem({
                    title: title,
                    url: url,
                    type: 'tv',
                    posterUrl: posterUrl
                }));
            });
            cb({ success: true, data: results });
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    async function load(url: string, cb: any) {
        try {
            const req = await fetch(url, { headers: HEADERS });
            const html = await req.text();
            const $ = LoadDoc(html);
            
            const episodes: any[] = [];
            const items = $(SELECTORS.EPISODE_ITEM);
            const seenUrls = new Set();
            
            items.each((_i: any, s: any) => {
                const epUrl = s.find(SELECTORS.EPISODE_LINK).attr("href");
                if (!epUrl || seenUrls.has(epUrl)) return;
                seenUrls.add(epUrl);
                
                const numStr = s.find(SELECTORS.EPISODE_NUMBER).text().trim();
                const epTitle = s.find(SELECTORS.EPISODE_TITLE).text().trim();
                const { season, episode } = extractEpisodeInfo(epUrl, numStr);
                
                episodes.push(new EpisodeItem({
                    title: epTitle || `Episode ${episode}`,
                    url: epUrl,
                    episode: episode,
                    season: season
                }));
            });
            
            episodes.reverse();
            
            const title = $('.entry-title').first().text().trim();
            const poster = $('.post-thumbnail img').attr('src');
            
            const result = new MultimediaItem({
                title: title,
                url: url,
                type: 'tv',
                episodes: episodes,
                posterUrl: poster
            });
            cb({ success: true, data: result });
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    async function loadStreams(url: string, cb: any) {
        try {
            const req = await fetch(url, { headers: HEADERS });
            const html = await req.text();
            const $ = LoadDoc(html);
            
            const iframeSrc = $('iframe[src*="/dub-player/"]').attr('src');
            if (!iframeSrc) {
                return cb({ success: false, message: "Could not find video player iframe." });
            }
            
            const embedUrl = iframeSrc.startsWith("http") ? iframeSrc : `${manifest.baseUrl}${iframeSrc}`;
            const embedReq = await fetch(embedUrl, { headers: { ...HEADERS, "Referer": url }});
            const embedHtml = await embedReq.text();
            
            const configMatch = embedHtml.match(/var\s+CONFIG\s*=\s*(\{.*?\});/);
            if (!configMatch) {
                return cb({ success: false, message: "Could not find AbyssPlayer config in embed." });
            }
            
            let config = JSON.parse(configMatch[1]);
            const streams: any[] = [];
            
            if (config.ready && typeof config.ready === 'object') {
                for (const langKey of Object.keys(config.ready)) {
                    const videoId = config.ready[langKey];
                    const langName = config.lang && config.lang[langKey] ? config.lang[langKey].name : langKey;
                    const abyssUrl = config.prefix + videoId;
                    
                    streams.push({
                        url: abyssUrl,
                        quality: "Auto",
                        name: `AbyssPlayer (${langName})`
                    });
                }
            }
            
            if (streams.length === 0) {
                return cb({ success: false, message: "No ready streams found in config." });
            }
            cb({ success: true, data: streams });
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    // Export to global scope for namespaced IIFE capture
    (globalThis as any).getHome = getHome;
    (globalThis as any).search = search;
    (globalThis as any).load = load;
    (globalThis as any).loadStreams = loadStreams;
})();
