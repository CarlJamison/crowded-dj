var token = window.location.pathname.split('/').at(-1);

function generateRandomString(length) {
    var text = '';
    var possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

    for (var i = 0; i < length; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
};

var userId = localStorage.getItem('userId');
if(!userId){
    var userId = generateRandomString(10);
    localStorage.setItem('userId', userId);
}