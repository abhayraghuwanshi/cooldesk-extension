(function () {
    try {
        var saved = localStorage.getItem('wallpaperEnabled');
        if (saved !== 'false') {
            document.body.classList.add('wallpaper-enabled');
            var url = localStorage.getItem('wallpaperUrl');
            if (url) {
                document.body.style.setProperty('--wallpaper-url', 'url("' + url + '")');
            }
            var opacity = localStorage.getItem('wallpaperOpacity');
            if (opacity) {
                document.body.style.setProperty('--wallpaper-opacity', opacity);
            }
        }
    } catch (e) { }
})();
