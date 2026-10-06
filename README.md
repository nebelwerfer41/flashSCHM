[Catalog](https://nebelwerfer41.github.io/) · [Repository](https://github.com/nebelwerfer41/flashSCHM)

# Flash SCHM

Schedule actor preparation for costume, hair, and makeup. Assign staff, view a timeline, and import or export Excel files.

## Usage

Configure the number and names of staff and department priorities. Add actors with their ready times and task durations, generate the schedule, and inspect the table and timeline. Import or export XLS/XLSX data.

## Local setup

Serve the folder with a static server and open the local address in a browser:

```sh
python3 -m http.server 8000 --bind 127.0.0.1
```

No build step is required. SheetJS (XLS/XLSX) and vis-timeline are loaded from CDNs.

## Limitations

The schedule is calculated from the supplied inputs. Check the result before operational use. Automatic integration with other Flash applications is not documented. CDN libraries require a connection when the page loads.

## License

[MIT](LICENSE). Copies and derivative works must retain the copyright notice and license text. Dependencies and third-party materials retain their own licenses.
