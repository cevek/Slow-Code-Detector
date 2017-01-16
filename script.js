document.addEventListener('click', function(e){
    var target = e.target;
    if (target.classList.contains('toggle-next')) {
        target.nextSibling.classList.toggle('hidden');
    }
});