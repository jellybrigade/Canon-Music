export const QK = {
  servers: () => ["servers"] as const,
  serverCredential: (serverId: string | undefined) => ["server-credential", serverId] as const,

  albums: (sort?: string, canonicalIds?: unknown) => ["albums", sort, canonicalIds] as const,
  albumsListeningStats: () => ["albums", "listening-stats"] as const,
  /** Partially-heard albums. Backs both "Finish the album" and "Almost done". */
  albumsPartiallyHeard: () => ["albums", "partially-heard"] as const,
  // Partial key for broad invalidation of all album queries
  albumsAll: () => ["albums"] as const,

  carousel: (type: string, serverId?: string) => ["carousel", type, serverId] as const,

  artists: () => ["artists"] as const,

  genreDisplayMappings: () => ["genre-display-mappings"] as const,

  search: (serverId: string, query: string) => ["search", serverId, query] as const,

  tagIssues: () => ["tag_issues"] as const,
  tagVocab: () => ["tag-vocab"] as const,
  tagMappings: () => ["tag_mappings"] as const,
  tagAlbums: (rawValue: string, kind: string) => ["tag-albums", rawValue, kind] as const,
  tagRapToHipHop: () => ["settings", "tags.rap_to_hiphop"] as const,

  trackTagsAlbum: (albumId: string) => ["track_tags", "album", albumId] as const,
  trackTagsAll: () => ["track_tags"] as const,
  trackTagsOffTree: () => ["track_tags", "off_tree_albums"] as const,
  trackTagsStats: () => ["track_tags", "stats"] as const,
  albumsTagsRefreshedAt: (albumId: string) => ["albums", "tags_refreshed_at", albumId] as const,
  albumsStale: (staleDays: number) => ["albums", "stale", staleDays] as const,

  recentlyReleased: (limit: number) => ["recently-released", limit] as const,
  spotlightGenres: (albumId: string) => ["spotlight-genres", albumId] as const,
  recommendedSpotlight: (albumId: string | null) => ["recommended-spotlight", albumId] as const,

  artistTopTracks: (artistName: string) => ["artist-top-tracks", artistName] as const,
  // Deliberately not artistTopTracks: this is a single-row probe, and writing a
  // one-element result under the full list's key would starve the artist page.
  artistSeedTrack: (artistName: string) => ["artist-seed-track", artistName] as const,
  artistAppearsOn: (artistName: string) => ["artist-appears-on", artistName] as const,
  artistGenres: (artistName: string) => ["artist-genres", artistName] as const,
  lastfmArtistTopAlbums: (artistName: string) => ["lastfm-artist-top-albums", artistName] as const,
  similarInLibrary: (names: string[]) => ["similar-in-library", names] as const,
  similarArtistAlbums: (names: string[]) => ["similar-artist-albums", names] as const,

  trackRawTags: (trackId: string | undefined) => ["track-raw-tags", trackId] as const,
  albumRawGenreMap: (albumId: string) => ["album-raw-genre-map", albumId] as const,
  trackRating: (nativeTrackId: string | null) => ["trackRating", nativeTrackId] as const,

  normalizedTags: (albumId: string) => ["normalized-tags", albumId] as const,
  normalizedTagsAll: () => ["normalized-tags"] as const,
  albumUnmatchedGenres: (albumId: string) => ["album-unmatched-genres", albumId] as const,
  albumGenreRawSources: (albumId: string) => ["album-genre-raw-sources", albumId] as const,
  albumGenreExclusions: (albumId: string) => ["album-genre-exclusions", albumId] as const,
  albumsLastComputedAt: () => ["albums", "last-computed-at"] as const,
  albumIdentityAll: () => ["album-identity"] as const,


  lyrics: (trackId: string | null, overrideArtist: string | null, overrideTitle: string | null) =>
    ["lyrics", trackId, overrideArtist, overrideTitle] as const,
  lyricsTrack: (trackId: string) => ["lyrics", trackId] as const,

  artistAliases: () => ["artist-aliases"] as const,
  artistCanonicalOf: (aliasName: string) => ["artist-aliases", "canonical-of", aliasName] as const,

  artistIdentity: (artistName: string) => ["artist-identity", artistName] as const,
  confirmedArtistMbid: (artistName: string) => ["confirmed-artist-mbid", artistName] as const,
  artistEnrichment: (artistName: string) => ["artist-enrichment", artistName] as const,
  lastfmArtistTopTracks: (artistName: string) => ["lastfm-artist-top-tracks", artistName] as const,
  lastfmTrackMatch: (artistName: string, trackIds: string[]) =>
    ["lastfm-track-match", artistName, trackIds] as const,
  identifyArtist: (artistName: string, mbArtistId?: string | null) =>
    ["identify-artist", artistName, mbArtistId] as const,

  albumIdentity: (albumId: string) => ["album-identity", albumId] as const,
  albumEnrichment: (albumId: string) => ["album-enrichment", albumId] as const,
  identifyAlbum: (albumId: string, mbRgId?: string | null, mbReleaseId?: string | null, artist?: string, album?: string, trackCount?: number, year?: number | null, confirmedArtistMbid?: string | null) =>
    ["identify-album", albumId, mbRgId, mbReleaseId, artist, album, trackCount, year, confirmedArtistMbid],
  autoIdentifyAlbum: (albumId: string, confirmedArtistMbid?: string | null) =>
    ["auto-identify-album", albumId, confirmedArtistMbid] as const,
  failedLookupAlbumIds: () => ["failed-lookup-album-ids"] as const,
  failedLookupAlbums: () => ["failed-lookup-albums"] as const,

  nowPlayingAlbums: (artistName: string | null) => ["nowplaying-albums", artistName] as const,
  nowPlayingTopTracks: (artistName: string | null) => ["nowplaying-top-tracks", artistName] as const,
  suggestedTracks: (artistName: string | null, trackId: string | null) =>
    ["suggested-tracks", artistName, trackId] as const,

  userTreeNodes: () => ["user-tree-nodes"] as const,
  userTreeChangelog: () => ["user-tree-changelog"] as const,

  settingsLastfmMinTagCount: () => ["settings", "lastfm.min_tag_count"] as const,
  settingsMbAutoIdentify: () => ["settings", "musicbrainz.auto_identify"] as const,
  settingsMbMinFolksonomy: () => ["settings", "musicbrainz.min_folksonomy_count"] as const,
  settingsFanartApiKey: () => ["settings", "fanart.api_key"] as const,
  settingsAll: () => ["settings"] as const,
  scrobbleQueueCount: (serverId?: string) => ["scrobble_queue", "count", serverId] as const,

  albumCovers: () => ["album-covers"] as const,
  albumCoversMissingCount: () => ["album-covers", "missing-count"] as const,

  artistCovers: () => ["artist-covers"] as const,
  artistCoversMissingCount: () => ["artist-covers", "missing-count"] as const,
} as const;
