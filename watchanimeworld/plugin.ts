(function() {
    const HEADERS = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    };

    declare const manifest: any;
    declare class MultimediaItem { constructor(data: any); }
    declare class Episode { constructor(data: any); }
    declare const http_get: any;

    function extractEpisodeInfo(url: string, title: string) {
        let season = 1;
        let episode = 1;
        const urlMatch = url.match(/(\d+)x(\d+)[^\/]*\/?$/i);
        if (urlMatch) {
            return { season: parseInt(urlMatch[1], 10), episode: parseInt(urlMatch[2], 10) };
        }
        const titleMatch = title.match(/(\d+)x(\d+)/i) || title.match(/S:?(\d+)-E:?(\d+)/i);
        if (titleMatch) {
            return { season: parseInt(titleMatch[1], 10), episode: parseInt(titleMatch[2], 10) };
        }
        return { season, episode };
    }

    function parseHtmlToItems(html: string) {
        const results: any[] = [];
        const articleRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
        let match;
        while ((match = articleRegex.exec(html)) !== null) {
            const articleHtml = match[1];
            
            const urlMatch = articleHtml.match(/<a[^>]+href=["']([^"']+)["']/i);
            const url = urlMatch ? urlMatch[1] : "";
            
            let titleMatch = articleHtml.match(/<[^>]+class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
            if (!titleMatch) titleMatch = articleHtml.match(/<img[^>]+alt=["']([^"']+)["']/i);
            let title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "";
            
            let imgMatch = articleHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
            if (!imgMatch || imgMatch[1].includes("data:image")) imgMatch = articleHtml.match(/<img[^>]+data-src=["']([^"']+)["']/i);
            let posterUrl = imgMatch ? imgMatch[1] : "";
            if (posterUrl.startsWith("//")) posterUrl = "https:" + posterUrl;
            else if (posterUrl.startsWith("/") && !posterUrl.startsWith("//")) posterUrl = manifest.baseUrl + posterUrl;
            
            if (url && title && !url.includes('/episode/') && !url.includes('${')) {
                title = title.replace(/\s*(?:\(\d{4}\)|Season|BluRay|HD|Multi Audio|Dual Audio|Hindi|Tamil|Telugu|\[).*$/i, '').replace(/[\(\)-]+$/, '').trim();
                results.push(new MultimediaItem({
                    title: title,
                    url: url,
                    type: 'tv',
                    posterUrl: posterUrl
                }));
            }
        }
        return results;
    }

    async function getHome(cb: any) {
        try {
            const sections = [
                { title: "New Episodes", path: "/" },
                { title: "Ongoing Anime", path: "/status/ongoing/" },
                { title: "Movies", path: "/movies/" },
                { title: "Trending", path: "/trending/" }
            ];
            
            const home: any = {};
            
            for (const sec of sections) {
                try {
                    const req = await http_get(`${manifest.baseUrl}${sec.path}`, { headers: HEADERS });
                    const html = req.body || "";
                    const results = parseHtmlToItems(html);
                    if (results.length > 0) {
                        home[sec.title] = results.slice(0, 20);
                    }
                } catch (e) {}
            }
            cb({ success: true, data: home });
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    async function search(query: string, cb: any) {
        const searchUrl = `${manifest.baseUrl}/?s=${encodeURIComponent(query)}`;
        try {
            const req = await http_get(searchUrl, { headers: HEADERS });
            const html = req.body || "";
            const results = parseHtmlToItems(html);
            cb({ success: true, data: results });
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    async function load(url: string, cb: any) {
        try {
            const req = await http_get(url, { headers: HEADERS });
            const html = req.body || "";
            
            const episodes: any[] = [];
            const seenUrls = new Set();
            
            const articleRegex = /<article[^>]+class=["'][^"']*episodes[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi;
            let m;
            while ((m = articleRegex.exec(html)) !== null) {
                const articleHtml = m[1];
                const urlMatch = articleHtml.match(/<a[^>]+href=["']([^"']+)["']/i);
                if (!urlMatch) continue;
                const epUrl = urlMatch[1];
                
                if (seenUrls.has(epUrl)) continue;
                seenUrls.add(epUrl);
                
                const numMatch = articleHtml.match(/<[^>]+class=["'][^"']*num-epi[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
                const titleMatch = articleHtml.match(/<[^>]+class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
                
                const numStr = numMatch ? numMatch[1].replace(/<[^>]+>/g, "").trim() : epUrl;
                const epTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : numStr;
                
                let posterMatch = articleHtml.match(/<img[^>]+src=["']([^"']+)["']/i);
                if (!posterMatch || posterMatch[1].includes("data:image")) posterMatch = articleHtml.match(/<img[^>]+data-src=["']([^"']+)["']/i);
                let epPoster = posterMatch ? posterMatch[1] : "";
                
                const { season, episode } = extractEpisodeInfo(epUrl, epTitle);
                
                episodes.push(new Episode({
                    title: epTitle || `Episode ${episode}`,
                    url: epUrl,
                    episode: episode,
                    season: season,
                    posterUrl: epPoster,
                    thumbnail: epPoster
                }));
            }
            
            // Fallback for older theme/movies
            if (episodes.length === 0) {
                const episodeRegex = /<a[^>]+href=["']([^"']+episode[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
                while ((m = episodeRegex.exec(html)) !== null) {
                    const aTag = m[0];
                    if (aTag.includes('class="lnk-blk"')) continue;
                    
                    const epUrl = m[1];
                    if (seenUrls.has(epUrl)) continue;
                    seenUrls.add(epUrl);
                    
                    const epHtml = m[2];
                    const numMatch = epHtml.match(/<[^>]+class=["'][^"']*num-epi[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
                    const titleMatch = epHtml.match(/<[^>]+class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
                    
                    const numStr = numMatch ? numMatch[1].replace(/<[^>]+>/g, "").trim() : epHtml.replace(/<[^>]+>/g, "").trim();
                    const epTitle = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : numStr;
                    const { season, episode } = extractEpisodeInfo(epUrl, epTitle);
                    
                    episodes.push(new Episode({
                        title: epTitle || `Episode ${episode}`,
                        url: epUrl,
                        episode: episode,
                        season: season
                    }));
                }
                episodes.reverse();
            }
            
            const titleMatch = html.match(/<[^>]+class=["'][^"']*entry-title[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i);
            const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, "").trim() : "Unknown Title";
            
            const posterMatch = html.match(/<div[^>]+class=["'][^"']*post-thumbnail[^"']*["'][^>]*>[\s\S]*?<img[^>]+src=["']([^"']+)["']/i);
            const poster = posterMatch ? posterMatch[1] : "";

            let description = "";
            let descMatch = html.match(/<div[^>]*class=["'][^"']*wp-content[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
            if (!descMatch) descMatch = html.match(/<div[^>]*class=["'][^"']*description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
            if (descMatch) {
                description = descMatch[1].replace(/<[^>]+>/g, " ").trim();
                description = description.replace(/\s{2,}/g, " ");
            }
            
            cb({ success: true, data: new MultimediaItem({
                title: title,
                url: url,
                type: 'tv',
                episodes: episodes,
                posterUrl: poster,
                description: description
            }) });
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    async function loadStreams(url: string, cb: any) {
        try {
            const req = await http_get(url, { headers: HEADERS });
            const html = req.body || "";
            
            const iframeMatch = html.match(/<iframe[^>]+src=["']([^"']+)["']/i);
            if (!iframeMatch) return cb({ success: false, message: "Could not find video player iframe." });
            
            const iframeSrc = iframeMatch[1];
            const embedUrl = iframeSrc.startsWith("http") ? iframeSrc : `${manifest.baseUrl}${iframeSrc}`;
            
            cb({ success: true, data: [{
                url: embedUrl,
                quality: "Auto",
                name: embedUrl.includes("zephyrix") ? "Zephyrix Player" : "Web Player"
            }]});
        } catch (e: any) {
            cb({ success: false, message: String(e) });
        }
    }

    (globalThis as any).getHome = getHome;
    (globalThis as any).search = search;
    (globalThis as any).load = load;
    (globalThis as any).loadStreams = loadStreams;
})();
