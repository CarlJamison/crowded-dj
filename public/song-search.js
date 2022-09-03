window.onload = () => {
    document.getElementById("search-text")
    .addEventListener("keypress", (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            search();
        }
    });
}

function search() {
    var query = document.getElementById('search-text').value;

    $.getJSON(`/${token}/search/${query}`, tracks => {
        $("div.search-results").html(`<div style="display:flex">
                <span style="flex:100">${tracks.length} result(s)</span>
                <button class="stage-button btn btn-primary" onclick="hideSearch()">Back</button>
            </div>`);

        tracks.forEach(track => {
            $("div.search-results").append(`<div class="result">
                <img class="album-pic" src="${track.album.images.at(-1).url}">
                <div style="margin: 8px; flex: 100">${track.name}</div>
                <div style="margin: 8px; text-align: right">${track.artists[0].name}</div>
                <button class="stage-button btn btn-primary" onclick="add('${track.id}')">Suggest</button>
            </div>`);
        });
    });
}

function add(id){
    $.ajax({url: `/${token}/add?song=${id}`, type: 'PUT', success: () => hideSearch()});
}

function hideSearch(){
    $("div.search-results").html("");
}