// Change the version number every time you redeploy, so phones fetch the new files.
const CACHE = "sankofa-v12";
const FILES = [
  "./",
  "./index.html",
  "./style.css",
  "./data.js",
  "./game.js",
  "./race.js",
  "./manifest.json",
  "./images/icon-192.png",
  "./images/icon-512.png",
  "./images/sankofa.svg",
  "./images/independence-arch-black-star-square.svg",
  "./images/mole-national-park.svg",
  "./images/kakum-canopy-walk.svg",
  "./images/emirates-stadium.svg",
  "./images/ford-model-t.svg",
  "./images/the-blue-marble.svg",
  "./images/jollof-rice.svg",
  "./images/larabanga-mosque.svg",
  "./images/bonwire-kente-village.svg",
  "./images/cape-coast-castle.svg",
  "./images/wli-waterfalls.svg",
  "./images/aburi-botanical-gardens.svg",
  "./images/tottenham-hotspur-stadium.svg",
  "./images/volkswagen-beetle.svg",
  "./images/apollo-11-moonwalk.svg",
  "./images/waakye.svg",
  "./images/great-mosque-of-djenne.svg",
  "./images/the-golden-stool.svg",
  "./images/elmina-castle.svg",
  "./images/lake-bosumtwi.svg",
  "./images/the-eiffel-tower.svg",
  "./images/wembley-stadium.svg",
  "./images/the-classic-mini.svg",
  "./images/international-space-station.svg",
  "./images/banku-tilapia.svg",
  "./images/sagrada-familia.svg",
  "./images/akuaba-figure.svg",
  "./images/manhyia-palace-museum.svg",
  "./images/victoria-falls.svg",
  "./images/the-taj-mahal.svg",
  "./images/maracana-stadium.svg",
  "./images/concorde.svg",
  "./images/hubble-space-telescope.svg",
  "./images/fufu-light-soup.svg",
  "./images/sydney-opera-house.svg",
  "./images/akan-gold-weights.svg",
  "./images/great-zimbabwe.svg",
  "./images/the-amazon-rainforest.svg",
  "./images/statue-of-liberty.svg",
  "./images/camp-nou.svg",
  "./images/shinkansen-bullet-train.svg",
  "./images/pillars-of-creation.svg",
  "./images/kelewele.svg",
  "./images/burj-khalifa.svg",
  "./images/rio-carnival.svg",
  "./images/pyramids-of-giza.svg",
  "./images/great-barrier-reef.svg",
  "./images/christ-the-redeemer.svg",
  "./images/fnb-stadium.svg",
  "./images/wright-flyer.svg",
  "./images/saturn.svg",
  "./images/sushi.svg",
  "./images/golden-gate-bridge.svg",
  "./images/holi.svg",
  "./images/the-colosseum.svg",
  "./images/the-serengeti.svg",
  "./images/big-ben.svg",
  "./images/baba-yara-stadium.svg",
  "./images/kantanka-car.svg",
  "./images/perseverance-rover.svg",
  "./images/neapolitan-pizza.svg",
  "./images/akosombo-dam.svg",
  "./images/dia-de-muertos.svg",
  "./images/machu-picchu.svg",
  "./images/mount-kilimanjaro.svg",
  "./images/santorini.svg",
  "./images/accra-sports-stadium.svg",
  "./images/ghana-s-tro-tro.svg",
  "./images/james-webb-space-telescope.svg",
  "./images/tacos.svg",
  "./images/petronas-twin-towers.svg"
];
// If you replace the .svg puzzle images with .png/.jpg, update the names above.

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)));
  self.skipWaiting();
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        if (res && res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
